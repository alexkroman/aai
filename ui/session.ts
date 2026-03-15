// Copyright 2025 the AAI authors. MIT license.
import { batch, type Signal, signal } from "@preact/signals";
import { PROTOCOL_VERSION } from "@aai/sdk/protocol";
import type {
  ClientEvent,
  ClientMessage,
  ReadyConfig,
  ServerMessage,
} from "@aai/sdk/protocol";

const SUPPORTED_PROTOCOL_VERSION = PROTOCOL_VERSION;

import type {
  AgentState,
  Message,
  SessionError,
  SessionOptions,
  ToolCallInfo,
} from "./types.ts";

import type { VoiceIO } from "./audio.ts";

/**
 * A reactive voice session that manages WebSocket communication,
 * audio capture/playback, and agent state transitions.
 *
 * Uses plain JSON text frames and binary audio frames for communication
 * and native WebSocket for the connection.
 *
 * Implements {@linkcode Disposable} for resource cleanup via `using`.
 */
export type VoiceSession = {
  /** Current agent state (connecting, listening, thinking, etc.). */
  readonly state: Signal<AgentState>;
  /** Chat message history for the session. */
  readonly messages: Signal<Message[]>;
  /** Active tool calls for the current turn. */
  readonly toolCalls: Signal<ToolCallInfo[]>;
  /**
   * Live user utterance from STT/VAD.
   * `null` = not speaking, `""` = speech detected but no text yet,
   * non-empty string = partial/final transcript text.
   */
  readonly userUtterance: Signal<string | null>;
  /** Current session error, or `null` if no error. */
  readonly error: Signal<SessionError | null>;
  /** Disconnection info, or `null` if connected. */
  readonly disconnected: Signal<{ intentional: boolean } | null>;
  /**
   * Open a WebSocket connection to the server and begin audio capture.
   *
   * @param options - Optional connection options.
   * @param options.signal - An AbortSignal that, when aborted, disconnects the session.
   */
  connect(options?: { signal?: AbortSignal }): void;
  /** Cancel the current agent turn and discard in-flight TTS audio. */
  cancel(): void;
  /** Clear messages, transcript, and error state without disconnecting. */
  resetState(): void;
  /** Reset the session: clear state and reconnect. */
  reset(): void;
  /** Close the WebSocket and release all audio resources. */
  disconnect(): void;
  /** Alias for {@linkcode disconnect} for use with `using`. */
  [Symbol.dispose](): void;
};

/**
 * Handles server→client messages and updates reactive Preact signals
 * accordingly (state transitions, transcripts, messages, audio playback).
 */
/** @internal Exported for testing only. */
export class ClientHandler {
  #state: Signal<AgentState>;
  #messages: Signal<Message[]>;
  #toolCalls: Signal<ToolCallInfo[]>;
  #userUtterance: Signal<string | null>;
  #error: Signal<SessionError | null>;
  #voiceIO: () => VoiceIO | null;
  #streaming = false;
  /** Incremented on each turn boundary — stale async callbacks compare against this. */
  #generation = 0;
  /** Buffered words with their audio start times (seconds). */
  #wordQueue: { text: string; start: number }[] = [];
  /** Number of words from #wordQueue already revealed in the UI. */
  #wordsRevealed = 0;
  /** TTS sample rate for converting samples → seconds. */
  #ttsSampleRate = 24_000;
  constructor(opts: {
    state: Signal<AgentState>;
    messages: Signal<Message[]>;
    toolCalls: Signal<ToolCallInfo[]>;
    userUtterance: Signal<string | null>;
    error: Signal<SessionError | null>;
    voiceIO: () => VoiceIO | null;
    ttsSampleRate?: number;
  }) {
    this.#state = opts.state;
    this.#messages = opts.messages;
    this.#toolCalls = opts.toolCalls;
    this.#userUtterance = opts.userUtterance;
    this.#error = opts.error;
    this.#voiceIO = opts.voiceIO;
    if (opts.ttsSampleRate) this.#ttsSampleRate = opts.ttsSampleRate;
  }

  /** Single entry point for all server→client session events. */
  event(e: ClientEvent): void {
    switch (e.type) {
      case "speech_started":
        this.#userUtterance.value = "";
        break;
      case "transcript":
        this.#userUtterance.value = e.text;
        break;
      case "turn":
        this.#generation++;
        this.#streaming = false;
        this.#wordQueue = [];
        this.#wordsRevealed = 0;
        batch(() => {
          this.#userUtterance.value = null;
          this.#messages.value = [
            ...this.#messages.value,
            { role: "user", text: e.text },
          ];
          this.#state.value = "thinking";
        });
        break;
      case "chat":
        this.#streaming = false;
        this.#messages.value = [
          ...this.#messages.value,
          { role: "assistant", text: e.text },
        ];
        break;
      case "words": {
        // Buffer words for playback-synced reveal
        for (const w of e.words) {
          this.#wordQueue.push(w);
        }
        if (!this.#streaming) {
          // First words of a new turn — start an empty assistant message
          this.#streaming = true;
          this.#messages.value = [
            ...this.#messages.value,
            { role: "assistant", text: "" },
          ];
        }
        break;
      }
      case "tool_call_start":
        this.#toolCalls.value = [
          ...this.#toolCalls.value,
          {
            toolCallId: e.toolCallId,
            toolName: e.toolName,
            args: e.args,
            status: "pending",
            afterMessageIndex: this.#messages.value.length - 1,
          },
        ];
        break;
      case "tool_call_done": {
        const tcs = this.#toolCalls.value;
        const idx = tcs.findIndex(
          (tc) => tc.toolCallId === e.toolCallId,
        );
        if (idx !== -1) {
          const updated = [...tcs];
          updated[idx] = { ...updated[idx]!, status: "done", result: e.result };
          this.#toolCalls.value = updated;
        }
        break;
      }
      case "tts_done":
        // No-audio turns (stt-only, empty LLM result) still use this event
        // to transition back to listening. Audio turns signal via stream end.
        this.#state.value = "listening";
        break;
      case "cancelled":
        this.#generation++;
        this.#voiceIO()?.flush();
        this.#wordQueue = [];
        this.#wordsRevealed = 0;
        this.#userUtterance.value = null;
        this.#state.value = "listening";
        break;
      case "reset": {
        this.#generation++;
        this.#voiceIO()?.flush();
        this.#wordQueue = [];
        this.#wordsRevealed = 0;
        batch(() => {
          this.#messages.value = [];
          this.#toolCalls.value = [];
          this.#userUtterance.value = null;
          this.#error.value = null;
          this.#state.value = "listening";
        });
        break;
      }
      case "error":
        console.error("Agent error:", e.message);
        batch(() => {
          this.#error.value = {
            code: e.code,
            message: e.message,
          };
          this.#state.value = "error";
        });
        break;
    }
  }

  playAudioChunk(chunk: Uint8Array): void {
    if (this.#state.value === "error") return;
    if (this.#state.value !== "speaking") {
      this.#state.value = "speaking";
    }
    this.#voiceIO()?.enqueue(chunk.buffer as ArrayBuffer);
  }

  playAudioDone(): void {
    const gen = this.#generation;
    const io = this.#voiceIO();
    if (io) {
      void io.done().then(() => {
        if (this.#generation !== gen) return;
        this.#revealAllWords();
        this.#state.value = "listening";
      });
    } else {
      this.#revealAllWords();
      this.#state.value = "listening";
    }
  }

  /** Called by VoiceIO when playback advances — reveals words whose start time has been reached. */
  onPlaybackProgress(samplesPlayed: number): void {
    if (!this.#streaming || this.#wordQueue.length === 0) return;
    const playbackTime = samplesPlayed / this.#ttsSampleRate;
    let newRevealed = this.#wordsRevealed;
    while (
      newRevealed < this.#wordQueue.length &&
      this.#wordQueue[newRevealed]!.start <= playbackTime
    ) {
      newRevealed++;
    }
    if (newRevealed > this.#wordsRevealed) {
      this.#wordsRevealed = newRevealed;
      this.#updateMessageText();
    }
  }

  /** Reveal all remaining buffered words. */
  #revealAllWords(): void {
    if (this.#wordsRevealed < this.#wordQueue.length) {
      this.#wordsRevealed = this.#wordQueue.length;
      this.#updateMessageText();
    }
    this.#wordQueue = [];
    this.#wordsRevealed = 0;
  }

  /** Update the last assistant message with revealed words. */
  #updateMessageText(): void {
    const text = this.#wordQueue
      .slice(0, this.#wordsRevealed)
      .map((w) => w.text)
      .join(" ");
    const msgs = this.#messages.value;
    if (msgs.length === 0) return;
    this.#messages.value = [
      ...msgs.slice(0, -1),
      { role: "assistant", text },
    ];
  }

  /**
   * Dispatch an incoming WebSocket message (text or binary).
   *
   * Returns the parsed config if the message is a `config` message,
   * otherwise `null`.
   */
  handleMessage(data: string | ArrayBuffer): ReadyConfig | null {
    // Binary frame → raw PCM16 TTS audio
    if (data instanceof ArrayBuffer) {
      this.playAudioChunk(new Uint8Array(data));
      return null;
    }

    // Text frame → JSON message
    let msg: ServerMessage;
    try {
      msg = JSON.parse(data);
    } catch {
      return null;
    }

    if (msg.type === "config") {
      const { type: _, ...config } = msg;
      return config as ReadyConfig;
    }

    if (msg.type === "audio_done") {
      this.playAudioDone();
      return null;
    }

    // All other messages are ClientEvent
    this.event(msg as ClientEvent);
    return null;
  }
}

/**
 * Create a voice session that connects to an AAI server via WebSocket.
 *
 * Uses plain JSON text frames and binary audio frames for communication.
 *
 * @param options - Session configuration including the platform server URL.
 * @returns A {@linkcode VoiceSession} handle for controlling the session.
 */
export function createVoiceSession(options: SessionOptions): VoiceSession {
  const state = signal<AgentState>("disconnected");
  const messages = signal<Message[]>([]);
  const toolCalls = signal<ToolCallInfo[]>([]);
  const userUtterance = signal<string | null>(null);
  const error = signal<SessionError | null>(null);
  const disconnected = signal<{ intentional: boolean } | null>(null);

  let ws: WebSocket | null = null;
  let voiceIO: VoiceIO | null = null;
  let connectionController: AbortController | null = null;
  let hasConnected = false;
  let audioSetupInFlight = false;
  let activeHandler: ClientHandler | null = null;
  function cleanupAudio(): void {
    audioSetupInFlight = false;
    void voiceIO?.close();
    voiceIO = null;
  }

  function resetState(): void {
    batch(() => {
      messages.value = [];
      toolCalls.value = [];
      userUtterance.value = null;
      error.value = null;
    });
  }

  function send(msg: ClientMessage): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  function sendBinary(data: ArrayBuffer): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }

  async function handleReady(msg: ReadyConfig): Promise<void> {
    if (audioSetupInFlight) return;

    // Protocol version check
    if (msg.protocolVersion !== SUPPORTED_PROTOCOL_VERSION) {
      batch(() => {
        error.value = {
          code: "protocol",
          message:
            `Server protocol v${msg.protocolVersion} is not compatible with client v${SUPPORTED_PROTOCOL_VERSION}. Please redeploy your agent.`,
        };
        state.value = "error";
      });
      return;
    }

    audioSetupInFlight = true;
    try {
      const [
        { createVoiceIO },
        captureWorklet,
        playbackWorklet,
      ] = await Promise.all([
        import("./audio.ts"),
        import("./worklets/capture-processor.js").then((m) =>
          m.default as unknown as string
        ),
        import("./worklets/playback-processor.js").then((m) =>
          m.default as unknown as string
        ),
      ]);
      const io = await createVoiceIO({
        sttSampleRate: msg.sampleRate,
        ttsSampleRate: msg.ttsSampleRate,
        captureWorkletSrc: captureWorklet,
        playbackWorkletSrc: playbackWorklet,
        onMicData: (pcm16: ArrayBuffer) => {
          if (state.value !== "listening") return;
          try {
            sendBinary(pcm16);
          } catch { /* connection may be closed */ }
        },
        onPlaybackProgress: (samplesPlayed: number) => {
          activeHandler?.onPlaybackProgress(samplesPlayed);
        },
      });
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        io.close();
        return;
      }
      voiceIO = io;
      send({ type: "audio_ready" });
      state.value = "listening";
    } catch (err: unknown) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      batch(() => {
        error.value = {
          code: "audio",
          message: `Microphone access failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        };
        state.value = "error";
      });
    } finally {
      audioSetupInFlight = false;
    }
  }

  function connect(opts?: { signal?: AbortSignal }): void {
    disconnected.value = null;
    state.value = "connecting";
    connectionController?.abort();
    const controller = new AbortController();
    connectionController = controller;
    const { signal: sig } = controller;

    if (opts?.signal) {
      opts.signal.addEventListener("abort", () => disconnect(), {
        signal: sig,
      });
    }

    const base = options.platformUrl;
    const wsUrl = new URL("websocket", base.endsWith("/") ? base : base + "/");
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
    if (hasConnected) wsUrl.searchParams.set("resume", "1");

    const socket = new WebSocket(wsUrl.toString());
    socket.binaryType = "arraybuffer";
    ws = socket;

    const handler = new ClientHandler({
      state,
      messages,
      toolCalls,
      userUtterance,
      error,
      voiceIO: () => voiceIO,
    });
    activeHandler = handler;

    socket.addEventListener("open", () => {
      state.value = "ready";
    }, { signal: sig });

    socket.addEventListener("message", (event: Event) => {
      const msgEvent = event as MessageEvent;
      const config = handler.handleMessage(msgEvent.data);
      if (config) {
        hasConnected = true;
        void handleReady(config);

        // Send history if reconnecting
        if (hasConnected && messages.value.length > 0) {
          send({
            type: "history",
            messages: messages.value.map((m) => ({
              role: m.role,
              text: m.text,
            })),
          });
        }
      }
    }, { signal: sig });

    socket.addEventListener("close", () => {
      if (sig.aborted) {
        return;
      }
      controller.abort();
      disconnected.value = { intentional: false };
      cleanupAudio();
      state.value = "disconnected";
    }, { signal: sig });
  }

  function cancel(): void {
    voiceIO?.flush();
    state.value = "listening";
    send({ type: "cancel" });
  }

  function reset(): void {
    voiceIO?.flush();
    if (ws && ws.readyState === WebSocket.OPEN) {
      send({ type: "reset" });
      return;
    }
    resetState();
    disconnect();
    connect();
  }

  function disconnect(): void {
    connectionController?.abort();
    connectionController = null;
    cleanupAudio();
    ws?.close();
    ws = null;
    state.value = "disconnected";
    disconnected.value = { intentional: true };
  }

  return {
    state,
    messages,
    toolCalls,
    userUtterance,
    error,
    disconnected,
    connect,
    cancel,
    resetState,
    reset,
    disconnect,
    [Symbol.dispose]() {
      disconnect();
    },
  };
}

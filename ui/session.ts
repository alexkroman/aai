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
  /** Live partial transcript from the STT engine. */
  readonly transcript: Signal<string>;
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
  #transcript: Signal<string>;
  #error: Signal<SessionError | null>;
  #voiceIO: () => VoiceIO | null;
  #streaming = false;
  constructor(opts: {
    state: Signal<AgentState>;
    messages: Signal<Message[]>;
    transcript: Signal<string>;
    error: Signal<SessionError | null>;
    voiceIO: () => VoiceIO | null;
  }) {
    this.#state = opts.state;
    this.#messages = opts.messages;
    this.#transcript = opts.transcript;
    this.#error = opts.error;
    this.#voiceIO = opts.voiceIO;
  }

  /** Single entry point for all server→client session events. */
  event(e: ClientEvent): void {
    switch (e.type) {
      case "transcript":
        this.#transcript.value = e.text;
        break;
      case "turn":
        this.#streaming = false;
        batch(() => {
          this.#transcript.value = "";
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
      case "chat_delta": {
        const msgs = this.#messages.value;
        if (this.#streaming) {
          // Append delta to the current streaming message
          const last = msgs[msgs.length - 1]!;
          this.#messages.value = [
            ...msgs.slice(0, -1),
            { role: "assistant", text: last.text + e.delta },
          ];
        } else {
          // First delta of a new turn — start a new message
          this.#streaming = true;
          this.#messages.value = [
            ...msgs,
            { role: "assistant", text: e.delta },
          ];
        }
        break;
      }
      case "tts_done":
        // No-audio turns (stt-only, empty LLM result) still use this event
        // to transition back to listening. Audio turns signal via stream end.
        this.#state.value = "listening";
        break;
      case "cancelled":
        this.#voiceIO()?.flush();
        this.#state.value = "listening";
        break;
      case "reset": {
        this.#voiceIO()?.flush();
        batch(() => {
          this.#messages.value = [];
          this.#transcript.value = "";
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
    const io = this.#voiceIO();
    if (io) {
      void io.done().then(() => {
        this.#state.value = "listening";
      });
    } else {
      this.#state.value = "listening";
    }
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
  const transcript = signal<string>("");
  const error = signal<SessionError | null>(null);
  const disconnected = signal<{ intentional: boolean } | null>(null);

  let ws: WebSocket | null = null;
  let voiceIO: VoiceIO | null = null;
  let connectionController: AbortController | null = null;
  let hasConnected = false;
  let audioSetupInFlight = false;
  function cleanupAudio(): void {
    audioSetupInFlight = false;
    void voiceIO?.close();
    voiceIO = null;
  }

  function resetState(): void {
    batch(() => {
      messages.value = [];
      transcript.value = "";
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
      transcript,
      error,
      voiceIO: () => voiceIO,
    });

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
    transcript,
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

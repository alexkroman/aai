// Copyright 2025 the AAI authors. MIT license.
import * as log from "@std/log";
import { StreamingTranscriber } from "assemblyai";
import type { TurnEvent } from "assemblyai";
import type { STTConfig } from "./types.ts";
import * as metrics from "./metrics.ts";

/** Detail payload emitted when a transcript (partial or final) is received. */
export type SttTranscriptDetail = {
  /** The transcribed text. */
  text: string;
  /** Whether this is a finalized transcript segment. */
  isFinal: boolean;
  /** The turn order index from the STT service, if available. */
  turnOrder?: number;
};

/** Detail payload emitted when a complete turn is detected by the STT service. */
export type SttTurnDetail = {
  /** The full transcribed text for this turn. */
  text: string;
  /** The turn order index from the STT service, if available. */
  turnOrder?: number;
};

/** A streaming speech-to-text connection to AssemblyAI. */
export type SttConnection = {
  /** Whether the WebSocket connection is currently open. */
  readonly connected: boolean;
  /** Whether the connection has been closed. */
  readonly closed: boolean;
  /** Opens the WebSocket connection to the STT service. */
  connect(): Promise<void>;
  /** Sends raw PCM audio data to the STT service. */
  send(audio: Uint8Array): void;
  /** Forces an endpoint on the current utterance, flushing buffered audio. */
  clear(): void;
  /** Closes the STT connection. */
  close(): void | Promise<void>;
  /** Callback invoked when VAD detects the user started speaking. */
  onSpeechStarted: (() => void) | null;
  /** Callback invoked when a transcript (partial or final) is received. */
  onTranscript: ((detail: SttTranscriptDetail) => void) | null;
  /** Callback invoked when a complete turn is detected. */
  onTurn: ((detail: SttTurnDetail) => void) | null;
  /** Callback invoked when an error occurs on the STT connection. */
  onError: ((error: Error) => void) | null;
  /** Callback invoked when the STT connection closes. */
  onClose: (() => void) | null;
};

/**
 * Creates a new streaming STT connection to AssemblyAI.
 *
 * The returned connection manages the WebSocket lifecycle, emits transcript
 * and turn events, and handles automatic reconnection on unexpected closes.
 *
 * @param apiKey - AssemblyAI API key for authentication.
 * @param config - STT configuration (sample rate, speech model, VAD settings).
 * @returns An {@linkcode SttConnection} ready to be connected via `.connect()`.
 */
export function createSttConnection(
  apiKey: string,
  config: STTConfig,
): SttConnection {
  let state: "Idle" | "Connecting" | "Open" | "Closed" = "Idle";
  let transcriber: StreamingTranscriber | null = null;
  let msgCount = 0;

  const conn: SttConnection = {
    onSpeechStarted: null,
    onTranscript: null,
    onTurn: null,
    onError: null,
    onClose: null,

    get connected(): boolean {
      return state === "Open";
    },

    get closed(): boolean {
      return state === "Closed";
    },

    async connect(): Promise<void> {
      if (state !== "Idle") {
        throw new Error(`Cannot connect: state is ${state}`);
      }

      state = "Connecting";
      const t0 = performance.now();

      log.info("Connecting to STT", {
        url: config.wssBase,
        speechModel: config.speechModel,
        sampleRate: config.sampleRate,
      });

      const t = new StreamingTranscriber({
        apiKey,
        websocketBaseUrl: config.wssBase,
        sampleRate: config.sampleRate,
        speechModel: config.speechModel as
          | "u3-rt-pro"
          | "whisper-rt"
          | "u3-pro"
          | "universal-streaming-english"
          | "universal-streaming-multilingual",
        formatTurns: config.formatTurns,
        minTurnSilence: config.minTurnSilence,
        maxTurnSilence: config.maxTurnSilence,
        vadThreshold: config.vadThreshold,
        ...(config.sttPrompt ? { prompt: config.sttPrompt } : {}),
      });

      wireTranscriber(t);

      try {
        await t.connect();
      } catch (err: unknown) {
        metrics.sttConnectDuration.observe((performance.now() - t0) / 1000);
        metrics.errorsTotal.inc({ component: "stt" });
        state = "Closed";
        const msg = apiKey
          ? err instanceof Error ? err.message : String(err)
          : "STT connection failed — ASSEMBLYAI_API_KEY is not set";
        throw new Error(msg);
      }

      metrics.sttConnectDuration.observe((performance.now() - t0) / 1000);
      log.info("STT WebSocket connected");

      transcriber = t;
      state = "Open";
    },

    send(audio: Uint8Array): void {
      if (state !== "Open") return;
      try {
        transcriber!.sendAudio(audio.buffer);
      } catch {
        log.warn("STT send skipped, ws not open");
      }
    },

    clear(): void {
      if (state !== "Open") return;
      try {
        transcriber!.forceEndpoint();
      } catch (e) {
        log.warn("STT forceEndpoint failed (socket may be closed)", e);
      }
    },

    async close(): Promise<void> {
      if (state === "Closed") return;
      state = "Closed";
      try {
        await transcriber?.close(false);
      } catch (e) {
        log.warn("STT close failed", e);
      }
      transcriber = null;
    },
  };

  function wireTranscriber(t: StreamingTranscriber): void {
    // speechStarted exists at runtime but is missing from the SDK's type overloads
    (t as unknown as { on(e: string, l: () => void): void }).on(
      "speechStarted",
      () => {
        log.info("STT speech started");
        conn.onSpeechStarted?.();
      },
    );

    t.on("turn", (turn: TurnEvent) => {
      msgCount++;
      const text = (turn.transcript ?? "").trim();
      log.info("STT message", {
        msgCount,
        type: "Turn",
        transcript: text.slice(0, 100),
        turnOrder: turn.turn_order,
        endOfTurn: turn.end_of_turn,
        turnIsFormatted: turn.turn_is_formatted,
      });

      if (!text) return;

      if (turn.end_of_turn) {
        conn.onTurn?.({ text, turnOrder: turn.turn_order });
      } else {
        conn.onTranscript?.({
          text,
          isFinal: false,
          turnOrder: turn.turn_order,
        });
      }
    });

    t.on("error", (err: Error) => {
      metrics.errorsTotal.inc({ component: "stt" });
      conn.onError?.(err);
    });

    t.on("close", (code: number, reason: string) => {
      log.info("STT WebSocket closed", { code, reason, msgCount });
      if (code !== 1000 && code !== 1005) {
        log.error("WebSocket closed unexpectedly", { code, reason });
        conn.onError?.(
          new Error(`STT WebSocket closed unexpectedly (code ${code})`),
        );
      }
      state = "Closed";
      transcriber = null;
      conn.onClose?.();
    });
  }

  return conn;
}

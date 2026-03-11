import { StreamingTranscriber } from "assemblyai";
import type { TurnEvent } from "assemblyai";
import type { STTConfig } from "./types.ts";
import * as metrics from "./metrics.ts";

export type SttTranscriptDetail = {
  text: string;
  isFinal: boolean;
  turnOrder?: number;
};
export type SttTurnDetail = { text: string; turnOrder?: number };
export type SttTerminationDetail = {
  audioDuration: number;
  sessionDuration: number;
};

export type SttHandle = EventTarget & {
  send: (audio: Uint8Array) => void;
  clear: () => void;
  close: () => void;
};

export async function connectStt(
  apiKey: string,
  config: STTConfig,
): Promise<SttHandle> {
  const sttStart = performance.now();

  console.info("Connecting to STT", {
    url: config.wssBase,
    speechModel: config.speechModel,
    sampleRate: config.sampleRate,
  });

  const transcriber = new StreamingTranscriber({
    apiKey,
    websocketBaseUrl: config.wssBase,
    sampleRate: config.sampleRate,
    speechModel: config.speechModel as
      | "u3-rt-pro"
      | "whisper-rt"
      | "universal-streaming-english"
      | "universal-streaming-multilingual",
    formatTurns: config.formatTurns,
    minTurnSilence: config.minTurnSilence,
    maxTurnSilence: config.maxTurnSilence,
    vadThreshold: config.vadThreshold,
    ...(config.sttPrompt ? { prompt: config.sttPrompt } : {}),
  });

  const target = new EventTarget();
  let msgCount = 0;

  transcriber.on("turn", (turn: TurnEvent) => {
    msgCount++;
    const text = (turn.transcript ?? "").trim();
    console.info("STT message", {
      msgCount,
      type: "Turn",
      transcript: text.slice(0, 100),
      turnOrder: turn.turn_order,
      endOfTurn: turn.end_of_turn,
      turnIsFormatted: turn.turn_is_formatted,
    });

    if (!text) return;

    if (turn.end_of_turn) {
      target.dispatchEvent(
        new CustomEvent<SttTurnDetail>("turn", {
          detail: { text, turnOrder: turn.turn_order },
        }),
      );
    } else {
      target.dispatchEvent(
        new CustomEvent<SttTranscriptDetail>("transcript", {
          detail: { text, isFinal: false, turnOrder: turn.turn_order },
        }),
      );
    }
  });

  transcriber.on("error", (err: Error) => {
    metrics.errorsTotal.inc({ component: "stt" });
    target.dispatchEvent(
      new CustomEvent<{ error: Error }>("error", { detail: { error: err } }),
    );
  });

  transcriber.on("close", (code: number, reason: string) => {
    console.info("STT WebSocket closed", { code, reason, msgCount });
    if (code !== 1000 && code !== 1005) {
      console.error("WebSocket closed unexpectedly", { code, reason });
      target.dispatchEvent(
        new CustomEvent<{ error: Error }>("error", {
          detail: {
            error: new Error(
              `STT WebSocket closed unexpectedly (code ${code})`,
            ),
          },
        }),
      );
    }
    target.dispatchEvent(new Event("close"));
  });

  try {
    await transcriber.connect();
  } catch (err: unknown) {
    metrics.sttConnectDuration.observe(
      (performance.now() - sttStart) / 1000,
    );
    metrics.errorsTotal.inc({ component: "stt" });
    const msg = apiKey
      ? err instanceof Error ? err.message : String(err)
      : "STT connection failed — ASSEMBLYAI_API_KEY is not set";
    throw new Error(msg);
  }

  metrics.sttConnectDuration.observe((performance.now() - sttStart) / 1000);
  console.info("STT WebSocket connected");

  return Object.assign(target, {
    send(audio: Uint8Array) {
      try {
        transcriber.sendAudio(audio.buffer as ArrayBuffer);
      } catch {
        console.warn("STT send skipped, ws not open");
      }
    },
    clear() {
      try {
        transcriber.forceEndpoint();
      } catch {
        // socket may already be closed
      }
    },
    close() {
      transcriber.close(false).catch(() => {});
    },
  }) as SttHandle;
}

import { deadline } from "@std/async/deadline";
import { getLogger } from "./logger.ts";
import { type STTConfig, SttMessageSchema } from "./types.ts";
import { createWebSocket, safeParseJSON } from "./ws.ts";

const STT_CONNECTION_TIMEOUT = 10_000;
const log = getLogger("stt");

export interface SttEvents {
  onTranscript: (text: string, isFinal: boolean, turnOrder?: number) => void;
  onTurn: (text: string, turnOrder?: number) => void;
  onTermination: (audioDuration: number, sessionDuration: number) => void;
  onError: (err: Error) => void;
  onClose: () => void;
}

export interface SttHandle {
  send: (audio: Uint8Array) => void;
  clear: () => void;
  close: () => void;
}

export async function connectStt(
  apiKey: string,
  config: STTConfig,
  events: SttEvents,
): Promise<SttHandle> {
  const params = new URLSearchParams({
    sample_rate: String(config.sampleRate),
    speech_model: config.speechModel,
    format_turns: String(config.formatTurns),
    min_end_of_turn_silence_when_confident: String(
      config.minEndOfTurnSilenceWhenConfident,
    ),
    max_turn_silence: String(config.maxTurnSilence),
    vad_threshold: String(config.vadThreshold),
  });
  if (config.prompt) {
    params.set("prompt", config.prompt);
  }

  const url = `${config.wssBase}?${params}`;
  const ws = createWebSocket(url, { Authorization: apiKey });

  const ac = new AbortController();
  const { signal } = ac;

  try {
    const handle = await deadline(
      new Promise<SttHandle>((resolve, reject) => {
        ws.addEventListener("open", () => {
          resolve({
            send(audio: Uint8Array) {
              if (ws.readyState === WebSocket.OPEN) ws.send(audio);
            },
            clear() {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "ForceEndpoint" }));
              }
            },
            close() {
              ws.close();
            },
          });
        }, { signal });

        let msgCount = 0;
        ws.addEventListener("message", (event: MessageEvent) => {
          if (typeof event.data !== "string") return;
          const parsed = safeParseJSON(event.data);
          if (parsed === null) {
            log.warn("Failed to parse message");
            return;
          }

          const result = SttMessageSchema.safeParse(parsed);
          if (!result.success) {
            log.warn("Invalid STT message, skipping", {
              error: result.error.message,
            });
            return;
          }

          const msg = result.data;
          msgCount++;
          if (msgCount <= 5) {
            log.debug("STT message", { msgCount, type: msg.type });
          }
          if (msg.type === "Termination") {
            events.onTermination(
              msg.audio_duration_seconds ?? 0,
              msg.session_duration_seconds ?? 0,
            );
          } else if (msg.type === "Transcript") {
            events.onTranscript(msg.transcript ?? "", msg.is_final ?? false);
          } else if (msg.type === "Turn") {
            const text = (msg.transcript ?? "").trim();
            if (!text) return;
            if (!msg.turn_is_formatted) {
              events.onTranscript(text, false, msg.turn_order);
              return;
            }
            events.onTurn(text, msg.turn_order);
          }
        }, { signal });

        ws.addEventListener("error", (event: Event) => {
          ac.abort();
          const err = event instanceof ErrorEvent
            ? new Error(event.message)
            : new Error("WebSocket error");
          events.onError(err);
          reject(err);
        });

        ws.addEventListener("close", (event: CloseEvent) => {
          ac.abort();
          if (event.code !== 1000 && event.code !== 1005) {
            log.error("WebSocket closed unexpectedly", {
              code: event.code,
              reason: event.reason ?? "",
            });
            events.onError(
              new Error(
                `STT WebSocket closed unexpectedly (code ${event.code})`,
              ),
            );
          }
          events.onClose();
        });
      }),
      STT_CONNECTION_TIMEOUT,
    );
    return handle;
  } catch (err: unknown) {
    ac.abort();
    ws.close();
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new Error("STT connection timeout");
    }
    throw err;
  }
}

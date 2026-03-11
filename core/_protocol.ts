// WebSocket wire-format types shared by server/ and ui/.

export const PROTOCOL_VERSION = 1;
export const DEFAULT_STT_SAMPLE_RATE = 16_000;
export const DEFAULT_TTS_SAMPLE_RATE = 24_000;
export const AUDIO_FORMAT = "pcm16" as const;

export type ServerMessage =
  | {
    type: "ready";
    protocol_version: number;
    audio_format: "pcm16";
    sample_rate: number;
    tts_sample_rate: number;
  }
  | { type: "partial_transcript"; text: string }
  | { type: "final_transcript"; text: string; turn_order?: number }
  | { type: "turn"; text: string; turn_order?: number }
  | { type: "chat"; text: string }
  | { type: "tts_done" }
  | { type: "cancelled" }
  | { type: "reset" }
  | { type: "error"; message: string; details?: string[] }
  | { type: "pong" };

/**
 * Binary audio frame specification. All audio exchanged over the WebSocket as
 * binary frames MUST conform to this spec. Any change here is a breaking
 * protocol change.
 */
export const AudioFrameSpec = {
  /** Audio codec identifier sent in the `ready` message. */
  format: "pcm16" as const,
  /** Signed 16-bit integer samples. */
  bitsPerSample: 16,
  /** Little-endian byte order. */
  endianness: "little" as const,
  /** Mono audio. */
  channels: 1,
  /** Bytes per sample (bitsPerSample / 8 * channels). */
  bytesPerSample: 2,
} as const;

export type ClientMessage =
  | { type: "audio_ready" }
  | { type: "cancel" }
  | { type: "reset" }
  | { type: "ping" }
  | {
    type: "history";
    messages: { role: "user" | "assistant"; text: string }[];
  };

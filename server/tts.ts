// Copyright 2025 the AAI authors. MIT license.
import type { TTSConfig } from "./types.ts";
import { createRimeTtsConnection } from "./tts_rime.ts";
import { createCartesiaTtsConnection } from "./tts_cartesia.ts";

/** A streaming text-to-speech connection. */
export type TtsConnection = {
  /** Whether the connection has been permanently closed. */
  readonly closed: boolean;
  /** Pre-establishes the connection for lower first-byte latency. */
  warmup(): void | Promise<void>;
  /**
   * Synthesizes text into streaming audio chunks.
   *
   * @param chunks - Text to synthesize (a single string or an async iterable of strings).
   * @param onAudio - Callback invoked with each PCM audio chunk as it arrives.
   * @param signal - Optional abort signal to cancel synthesis.
   */
  synthesizeStream(
    chunks: string | AsyncIterable<string>,
    onAudio: (chunk: Uint8Array) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  /** Permanently closes the TTS connection and releases resources. */
  close(): void;
};

/**
 * Creates a TTS connection for the given config.
 *
 * Dispatches to the appropriate provider based on `config.provider`.
 */
export function createTtsConnection(config: TTSConfig): TtsConnection {
  switch (config.provider) {
    case "rime":
      return createRimeTtsConnection(config);
    case "cartesia":
      return createCartesiaTtsConnection(config);
    default:
      throw new Error(
        `Unknown TTS provider: ${(config as { provider: string }).provider}`,
      );
  }
}

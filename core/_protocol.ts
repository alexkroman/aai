// WebSocket wire-format types shared by server/ and ui/.
// Zod schemas are the source of truth; TypeScript types are derived via z.infer.

import { z } from "zod";

export const DEFAULT_STT_SAMPLE_RATE = 16_000;
export const DEFAULT_TTS_SAMPLE_RATE = 24_000;

// ---------------------------------------------------------------------------
// Server → Client Zod schema (source of truth)
// ---------------------------------------------------------------------------

export const ServerMessageSchema = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("ready"),
      sample_rate: z.number(),
      tts_sample_rate: z.number(),
    }),
    z.object({ type: z.literal("partial_transcript"), text: z.string() }),
    z.object({
      type: z.literal("final_transcript"),
      text: z.string(),
      turn_order: z.number().optional(),
    }),
    z.object({
      type: z.literal("turn"),
      text: z.string(),
      turn_order: z.number().optional(),
    }),
    z.object({ type: z.literal("chat"), text: z.string() }),
    z.object({ type: z.literal("chat_delta"), text: z.string() }),
    z.object({ type: z.literal("chat_done"), text: z.string() }),
    z.object({ type: z.literal("tts_done") }),
    z.object({ type: z.literal("cancelled") }),
    z.object({ type: z.literal("reset") }),
    z.object({
      type: z.literal("error"),
      message: z.string(),
      details: z.array(z.string()).optional(),
    }),
    z.object({ type: z.literal("pong") }),
  ]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;

/** PCM16 LE audio. Client sends at `sample_rate`, server sends at `tts_sample_rate`. */
export type AudioFrame = ArrayBuffer;

// ---------------------------------------------------------------------------
// Client → Server
// ---------------------------------------------------------------------------

export const ClientMessageSchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("audio_ready") }),
    z.object({ type: z.literal("cancel") }),
    z.object({ type: z.literal("reset") }),
    z.object({ type: z.literal("ping") }),
    z.object({
      type: z.literal("history"),
      messages: z.array(z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string(),
      })),
    }),
  ]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

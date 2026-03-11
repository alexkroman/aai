import { expect } from "@std/expect";
import {
  AUDIO_FORMAT,
  AudioFrameSpec,
  ClientMessageSchema,
  DEFAULT_STT_SAMPLE_RATE,
  DEFAULT_TTS_SAMPLE_RATE,
  PROTOCOL_VERSION,
  ServerMessageSchema,
} from "./_protocol.ts";

Deno.test("protocol constants", async (t) => {
  await t.step("default sample rates", () => {
    expect(DEFAULT_STT_SAMPLE_RATE).toBe(16_000);
    expect(DEFAULT_TTS_SAMPLE_RATE).toBe(24_000);
  });
  await t.step("protocol version", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });
  await t.step("audio format", () => {
    expect(AUDIO_FORMAT).toBe("pcm16");
  });
});

Deno.test("ServerMessageSchema", async (t) => {
  const validMessages: [string, unknown][] = [
    ["ready", {
      type: "ready",
      protocol_version: 1,
      audio_format: "pcm16",
      sample_rate: 16000,
      tts_sample_rate: 24000,
    }],
    ["partial_transcript", { type: "partial_transcript", text: "hello" }],
    [
      "final_transcript",
      { type: "final_transcript", text: "hello world", turn_order: 1 },
    ],
    ["turn", { type: "turn", text: "response" }],
    ["chat", { type: "chat", text: "hi" }],
    ["tts_done", { type: "tts_done" }],
    ["cancelled", { type: "cancelled" }],
    ["reset", { type: "reset" }],
    [
      "error",
      { type: "error", message: "broke", details: ["detail1", "detail2"] },
    ],
    ["pong", { type: "pong" }],
  ];

  for (const [label, msg] of validMessages) {
    await t.step(`accepts ${label}`, () => {
      expect(ServerMessageSchema.safeParse(msg).success).toBe(true);
    });
  }

  await t.step("rejects unknown type", () => {
    expect(ServerMessageSchema.safeParse({ type: "unknown" }).success).toBe(
      false,
    );
  });
});

Deno.test("ClientMessageSchema", async (t) => {
  for (const type of ["audio_ready", "cancel", "reset", "ping"]) {
    await t.step(`accepts ${type}`, () => {
      expect(ClientMessageSchema.safeParse({ type }).success).toBe(true);
    });
  }

  await t.step("accepts history with messages", () => {
    const result = ClientMessageSchema.safeParse({
      type: "history",
      messages: [
        { role: "user", text: "hello" },
        { role: "assistant", text: "hi" },
      ],
    });
    expect(result.success).toBe(true);
  });

  await t.step("rejects history with invalid role", () => {
    const result = ClientMessageSchema.safeParse({
      type: "history",
      messages: [{ role: "system", text: "hello" }],
    });
    expect(result.success).toBe(false);
  });
});

Deno.test("AudioFrameSpec", async (t) => {
  await t.step("format matches AUDIO_FORMAT", () => {
    expect(AudioFrameSpec.format).toBe(AUDIO_FORMAT);
  });

  await t.step("bytesPerSample is consistent", () => {
    expect(AudioFrameSpec.bytesPerSample).toBe(
      (AudioFrameSpec.bitsPerSample / 8) * AudioFrameSpec.channels,
    );
  });
});

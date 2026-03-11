import { expect } from "@std/expect";
import {
  AUDIO_FORMAT,
  AudioFrameSpec,
  DEFAULT_STT_SAMPLE_RATE,
  DEFAULT_TTS_SAMPLE_RATE,
  PROTOCOL_VERSION,
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

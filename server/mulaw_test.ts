// Copyright 2025 the AAI authors. MIT license.
import { assert, assertStrictEquals } from "@std/assert";
import {
  decodeMulaw,
  encodeMulaw,
  mulawToPcm16,
  pcm16ToMulaw,
  resample,
} from "./mulaw.ts";

Deno.test("encodeMulaw / decodeMulaw roundtrip", async (t) => {
  await t.step("silence encodes and decodes to near-zero", () => {
    const encoded = encodeMulaw(0);
    const decoded = decodeMulaw(encoded);
    assert(Math.abs(decoded) < 10);
  });

  await t.step("positive sample roundtrips within tolerance", () => {
    const sample = 10000;
    const decoded = decodeMulaw(encodeMulaw(sample));
    // mulaw is lossy — allow ~2% error for mid-range values
    assert(Math.abs(decoded - sample) / sample < 0.05);
  });

  await t.step("negative sample roundtrips within tolerance", () => {
    const sample = -10000;
    const decoded = decodeMulaw(encodeMulaw(sample));
    assert(Math.abs(decoded - sample) / Math.abs(sample) < 0.05);
  });

  await t.step("clamps values beyond max", () => {
    const encoded = encodeMulaw(40000);
    const decoded = decodeMulaw(encoded);
    // Should be clamped to max representable value
    assert(decoded <= 32767);
  });

  await t.step("byte range is 0-255", () => {
    for (const sample of [-32768, -1000, 0, 1000, 32767]) {
      const byte = encodeMulaw(sample);
      assert(byte >= 0);
      assert(byte <= 255);
    }
  });
});

Deno.test("mulawToPcm16 / pcm16ToMulaw", async (t) => {
  await t.step("roundtrips buffer of samples", () => {
    const pcm = new Int16Array([0, 1000, -1000, 16000, -16000]);
    const mulaw = pcm16ToMulaw(pcm);
    assertStrictEquals(mulaw.length, pcm.length);

    const back = mulawToPcm16(mulaw);
    assertStrictEquals(back.length, pcm.length);
    for (let i = 0; i < pcm.length; i++) {
      assert(
        Math.abs(back[i]! - pcm[i]!) / (Math.abs(pcm[i]!) || 1) < 0.1,
      );
    }
  });

  await t.step("handles empty input", () => {
    assertStrictEquals(mulawToPcm16(new Uint8Array(0)).length, 0);
    assertStrictEquals(pcm16ToMulaw(new Int16Array(0)).length, 0);
  });
});

Deno.test("resample", async (t) => {
  await t.step("returns same array when rates match", () => {
    const input = new Int16Array([100, 200, 300]);
    const out = resample(input, { fromRate: 8000, toRate: 8000 });
    assertStrictEquals(out, input);
  });

  await t.step("downsamples correctly", () => {
    const input = new Int16Array(16);
    for (let i = 0; i < 16; i++) input[i] = i * 100;
    const out = resample(input, { fromRate: 16000, toRate: 8000 });
    assertStrictEquals(out.length, 8);
  });

  await t.step("upsamples correctly", () => {
    const input = new Int16Array(8);
    for (let i = 0; i < 8; i++) input[i] = i * 100;
    const out = resample(input, { fromRate: 8000, toRate: 16000 });
    assertStrictEquals(out.length, 16);
  });

  await t.step("preserves DC signal", () => {
    const input = new Int16Array(100).fill(5000);
    const out = resample(input, { fromRate: 16000, toRate: 8000 });
    for (let i = 0; i < out.length; i++) {
      assert(Math.abs(out[i]! - 5000) < 2);
    }
  });
});

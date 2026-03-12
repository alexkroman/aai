// Copyright 2025 the AAI authors. MIT license.
import { assertStrictEquals, assertThrows } from "@std/assert";
import { loadPlatformConfig } from "./config.ts";
import { DEFAULT_MODEL } from "./types.ts";

const validEnv = { ASSEMBLYAI_API_KEY: "test-key-123" };

Deno.test("loadPlatformConfig loads config from valid env", () => {
  const config = loadPlatformConfig(validEnv);
  assertStrictEquals(config.apiKey, "test-key-123");
  assertStrictEquals(config.model, DEFAULT_MODEL);
  assertStrictEquals(config.sttConfig.sampleRate, 16_000);
});

Deno.test("loadPlatformConfig throws when ASSEMBLYAI_API_KEY is missing", () => {
  assertThrows(() => loadPlatformConfig({}));
});

Deno.test("loadPlatformConfig throws when ASSEMBLYAI_API_KEY is empty", () => {
  assertThrows(() => loadPlatformConfig({ ASSEMBLYAI_API_KEY: "" }));
});

Deno.test("loadPlatformConfig uses LLM_MODEL override", () => {
  const config = loadPlatformConfig({ ...validEnv, LLM_MODEL: "custom-model" });
  assertStrictEquals(config.model, "custom-model");
});

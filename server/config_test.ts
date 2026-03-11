import { expect } from "@std/expect";
import { loadPlatformConfig } from "./config.ts";

const validEnv = { ASSEMBLYAI_API_KEY: "test-key-123" };

Deno.test("loadPlatformConfig loads config from valid env", () => {
  const config = loadPlatformConfig(validEnv);
  expect(config.apiKey).toBe("test-key-123");
  expect(config.s2sConfig.inputSampleRate).toBe(24_000);
  expect(config.s2sConfig.outputSampleRate).toBe(24_000);
});

Deno.test("loadPlatformConfig throws when ASSEMBLYAI_API_KEY is missing", () => {
  expect(() => loadPlatformConfig({})).toThrow();
});

Deno.test("loadPlatformConfig throws when ASSEMBLYAI_API_KEY is empty", () => {
  expect(() => loadPlatformConfig({ ASSEMBLYAI_API_KEY: "" })).toThrow();
});

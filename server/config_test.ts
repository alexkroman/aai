import { expect } from "@std/expect";
import { loadPlatformConfig } from "./config.ts";
import { DEFAULT_MODEL } from "./types.ts";

Deno.test("loadPlatformConfig", async (t) => {
  const validEnv = {
    ASSEMBLYAI_API_KEY: "test-key-123",
    ASSEMBLYAI_TTS_API_KEY: "test-tts-key-456",
  };

  await t.step("loads config from valid env", () => {
    const config = loadPlatformConfig(validEnv);
    expect(config.apiKey).toBe("test-key-123");
    expect(config.model).toBe(DEFAULT_MODEL);
    expect(config.sttConfig.sampleRate).toBe(16_000);
    expect(config.ttsConfig.apiKey).toBe("test-tts-key-456");
    expect(config.llmGatewayBase).toBe(
      "https://llm-gateway.assemblyai.com/v1",
    );
  });

  await t.step("throws when ASSEMBLYAI_API_KEY is missing", () => {
    expect(() => loadPlatformConfig({ ASSEMBLYAI_TTS_API_KEY: "key" }))
      .toThrow();
  });

  await t.step("defaults ASSEMBLYAI_TTS_API_KEY to empty string", () => {
    const config = loadPlatformConfig({ ASSEMBLYAI_API_KEY: "key" });
    expect(config.ttsConfig.apiKey).toBe("");
  });

  await t.step("throws when ASSEMBLYAI_API_KEY is empty string", () => {
    expect(() =>
      loadPlatformConfig({
        ASSEMBLYAI_API_KEY: "",
        ASSEMBLYAI_TTS_API_KEY: "key",
      })
    ).toThrow();
  });

  await t.step("uses LLM_MODEL override when provided", () => {
    const config = loadPlatformConfig({
      ...validEnv,
      LLM_MODEL: "custom-model",
    });
    expect(config.model).toBe("custom-model");
  });
});

// Copyright 2025 the AAI authors. MIT license.
import {
  DEFAULT_CARTESIA_TTS_CONFIG,
  DEFAULT_MODEL,
  DEFAULT_RIME_TTS_CONFIG,
  DEFAULT_S2S_CONFIG,
  DEFAULT_STT_CONFIG,
  type S2SConfig,
  type STTConfig,
  type TTSConfig,
} from "./types.ts";
import { EnvSchema } from "./_schemas.ts";

export type PlatformConfig = {
  apiKey: string;
  anthropicApiKey?: string | undefined;
  sttConfig: STTConfig;
  ttsConfig: TTSConfig;
  s2sConfig: S2SConfig;
  model: string;
  llmGatewayBase: string;
};

export function loadPlatformConfig(
  env: Record<string, string | undefined>,
): PlatformConfig {
  const parsed = EnvSchema.parse(env);

  const cartesiaKey = Deno.env.get("CARTESIA_API_KEY") ?? "";
  const rimeKey = Deno.env.get("RIME_API_KEY") ?? "";
  const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

  let ttsConfig: TTSConfig;
  if (cartesiaKey) {
    ttsConfig = { ...DEFAULT_CARTESIA_TTS_CONFIG, apiKey: cartesiaKey };
  } else if (rimeKey) {
    ttsConfig = { ...DEFAULT_RIME_TTS_CONFIG, apiKey: rimeKey };
  } else {
    ttsConfig = { ...DEFAULT_CARTESIA_TTS_CONFIG };
  }

  return {
    apiKey: parsed.ASSEMBLYAI_API_KEY,
    anthropicApiKey,
    sttConfig: { ...DEFAULT_STT_CONFIG },
    ttsConfig,
    s2sConfig: { ...DEFAULT_S2S_CONFIG },
    model: parsed.LLM_MODEL ?? DEFAULT_MODEL,
    llmGatewayBase: "https://llm-gateway.assemblyai.com/v1",
  };
}

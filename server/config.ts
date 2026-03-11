import { z } from "zod";
import { DEFAULT_S2S_CONFIG } from "./types.ts";
import { EnvSchema } from "./_schemas.ts";

export const PlatformConfigSchema = z.object({
  apiKey: z.string().min(1),
  s2sConfig: z.object({
    wssUrl: z.string(),
    inputSampleRate: z.number(),
    outputSampleRate: z.number(),
  }),
});

export type PlatformConfig = z.infer<typeof PlatformConfigSchema>;

export function loadPlatformConfig(
  env: Record<string, string | undefined>,
): PlatformConfig {
  const parsed = EnvSchema.parse(env);

  return PlatformConfigSchema.parse({
    apiKey: parsed.ASSEMBLYAI_API_KEY,
    s2sConfig: { ...DEFAULT_S2S_CONFIG },
  });
}

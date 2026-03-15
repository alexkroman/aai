// Copyright 2025 the AAI authors. MIT license.
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModelV1 } from "ai";
import { createGatewayModel } from "./provider_gateway.ts";

export type CreateModelOptions = {
  apiKey: string;
  anthropicApiKey?: string | undefined;
  model: string;
  gatewayBase?: string;
};

export function createModel(opts: CreateModelOptions): LanguageModelV1 {
  if (opts.anthropicApiKey) {
    const anthropic = createAnthropic({ apiKey: opts.anthropicApiKey });
    return anthropic(opts.model);
  }

  return createGatewayModel({
    apiKey: opts.apiKey,
    model: opts.model,
    gatewayBase: opts.gatewayBase,
  });
}

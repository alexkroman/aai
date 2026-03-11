// Zod validation schemas for server-side use only.
// The canonical types live in sdk/_schema.ts.

import { z } from "zod";
import type {
  AgentConfig,
  AgentEnv,
  BuiltinTool,
  DeployBody,
  ToolSchema,
  Transport,
} from "@aai/sdk/schema";
import type { ClientMessage, ServerMessage } from "@aai/core/protocol";

export type AgentMetadata = {
  slug: string;
  env: Record<string, string>;
  transport: Transport[];
  owner_hash?: string;
  config?: AgentConfig;
  toolSchemas?: ToolSchema[];
};

export const TransportSchema: z.ZodType<Transport> = z.enum([
  "websocket",
  "twilio",
]);

export const BuiltinToolSchema: z.ZodType<BuiltinTool> = z.enum([
  "web_search",
  "visit_webpage",
  "fetch_json",
  "run_code",
  "user_input",
  "final_answer",
]);

export const AgentConfigSchema: z.ZodType<AgentConfig> = z.object({
  name: z.string().optional(),
  instructions: z.string(),
  greeting: z.string(),
  voice: z.string(),
  sttPrompt: z.string().optional(),
  stopWhen: z.number().optional(),
  builtinTools: z.array(BuiltinToolSchema).optional(),
});

export const ToolSchemaSchema: z.ZodType<ToolSchema> = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.record(z.string(), z.unknown()),
});

export const DeployBodySchema: z.ZodType<DeployBody> = z.object({
  env: z.record(z.string(), z.string()),
  worker: z.string().min(1).max(10_000_000),
  client: z.string().min(1).max(10_000_000),
  transport: z.union([
    TransportSchema,
    z.array(TransportSchema),
  ]).optional(),
  config: AgentConfigSchema,
  toolSchemas: z.array(ToolSchemaSchema).optional(),
});

export const EnvSchema: z.ZodType<AgentEnv> = z.object({
  ASSEMBLYAI_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().optional(),
}).passthrough();

export const AgentMetadataSchema: z.ZodType<AgentMetadata> = z.object({
  slug: z.string(),
  env: z.record(z.string(), z.string()).default({}),
  transport: z.array(TransportSchema).default(["websocket"]),
  owner_hash: z.string().optional(),
  config: AgentConfigSchema.optional(),
  toolSchemas: z.array(ToolSchemaSchema).optional(),
});

export const ServerMessageSchema: z.ZodType<ServerMessage> = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("ready"),
      protocol_version: z.number(),
      audio_format: z.literal("pcm16"),
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

export const ClientMessageSchema: z.ZodType<ClientMessage> = z
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

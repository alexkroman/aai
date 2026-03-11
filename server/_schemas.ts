// Zod validation schemas for server-side use.
// Protocol schemas (ServerMessage, ClientMessage, KV, Twilio) live in
// @aai/core/protocol as the single source of truth.

import { z } from "zod";
import type {
  AgentConfig,
  AgentEnv,
  BuiltinTool,
  DeployBody,
  ToolSchema,
  Transport,
} from "@aai/sdk/schema";
// Re-export protocol schemas so existing server/ imports keep working.
export {
  ClientMessageSchema,
  ServerMessageSchema,
  TwilioMessageSchema,
} from "@aai/core/protocol";
import type { KvRequest } from "@aai/core/protocol";

export type AgentMetadata = {
  slug: string;
  env: Record<string, string>;
  transport: Transport[];
  owner_hash?: string;
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
});

// KV HTTP endpoint: base operations + server-only `keys` operation.
export type KvHttpRequest =
  | KvRequest
  | { op: "keys"; pattern?: string };

export const KvHttpRequestSchema: z.ZodType<KvHttpRequest> = z
  .discriminatedUnion("op", [
    z.object({ op: z.literal("get"), key: z.string() }),
    z.object({
      op: z.literal("set"),
      key: z.string(),
      value: z.string(),
      ttl: z.number().optional(),
    }),
    z.object({ op: z.literal("del"), key: z.string() }),
    z.object({
      op: z.literal("list"),
      prefix: z.string(),
      limit: z.number().optional(),
      reverse: z.boolean().optional(),
    }),
    z.object({ op: z.literal("keys"), pattern: z.string().optional() }),
  ]);

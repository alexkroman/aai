/**
 * Zod schemas and types for agent configuration wire format.
 *
 * @module
 */

import { z } from "zod";

/** Transport protocol for client-server communication. */
export type Transport = "websocket" | "twilio";

/** Zod schema for {@linkcode Transport}. */
export const TransportSchema: z.ZodType<Transport> = z.enum([
  "websocket",
  "twilio",
]);

/** Normalize a transport value to an array. */
export function normalizeTransport(
  value: Transport | Transport[] | undefined,
): Transport[] {
  if (value === undefined) return ["websocket"];
  if (typeof value === "string") return [value];
  return value;
}

/** Identifier for a built-in server-side tool. */
export type BuiltinTool =
  | "web_search"
  | "visit_webpage"
  | "fetch_json"
  | "run_code"
  | "user_input"
  | "final_answer";

/** Zod schema for {@linkcode BuiltinTool}. */
export const BuiltinToolSchema: z.ZodType<BuiltinTool> = z.enum([
  "web_search",
  "visit_webpage",
  "fetch_json",
  "run_code",
  "user_input",
  "final_answer",
]);

/** How the LLM should select tools during a turn. */
export type ToolChoice =
  | "auto"
  | "required"
  | "none"
  | { type: "tool"; toolName: string };

/** Zod schema for {@linkcode ToolChoice}. */
export const ToolChoiceSchema: z.ZodType<ToolChoice> = z.union([
  z.enum(["auto", "required", "none"]),
  z.object({ type: z.literal("tool"), toolName: z.string().min(1) }),
]);

/** Agent operating mode. */
export type AgentMode = "full" | "stt-only";

/** Zod schema for {@linkcode AgentMode}. */
export const AgentModeSchema: z.ZodType<AgentMode> = z.enum([
  "full",
  "stt-only",
]);

/** Serializable agent configuration sent over the wire. */
export type AgentConfig = {
  name: string;
  mode?: AgentMode;
  instructions: string;
  greeting: string;
  voice: string;
  sttPrompt?: string;
  maxSteps?: number;
  toolChoice?: ToolChoice;
  transport?: Transport | Transport[];
  builtinTools?: BuiltinTool[];
};

/** Zod schema for {@linkcode AgentConfig}. */
export const AgentConfigSchema: z.ZodType<AgentConfig> = z.object({
  name: z.string().min(1),
  mode: AgentModeSchema.optional(),
  instructions: z.string(),
  greeting: z.string(),
  voice: z.string(),
  sttPrompt: z.string().min(1).optional(),
  maxSteps: z.number().int().positive().optional(),
  toolChoice: ToolChoiceSchema.optional(),
  transport: z.union([
    TransportSchema,
    z.array(TransportSchema).min(1),
  ]).optional(),
  builtinTools: z.array(BuiltinToolSchema).optional(),
});

/**
 * Serialized tool schema sent over the wire.
 * `parameters` must be a valid JSON Schema object (with `type`, `properties`,
 * etc.) — the Vercel AI SDK wraps it via `jsonSchema()`.
 */
export type ToolSchema = {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
};

/** Zod schema for {@linkcode ToolSchema}. */
export const ToolSchemaSchema: z.ZodType<ToolSchema> = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  parameters: z.object({
    type: z.literal("object"),
    properties: z.record(z.string(), z.unknown()).optional(),
    required: z.array(z.string()).optional(),
  }).catchall(z.unknown()),
});

/** Request body for the deploy endpoint. */
export type DeployBody = {
  env: Record<string, string>;
  worker: string;
  client: string;
  transport?: Transport | Transport[];
};

/** Zod schema for {@linkcode DeployBody}. */
export const DeployBodySchema: z.ZodType<DeployBody> = z.object({
  env: z.record(z.string(), z.string()),
  worker: z.string().min(1).max(10_000_000),
  client: z.string().min(1).max(10_000_000),
  transport: z.union([
    TransportSchema,
    z.array(TransportSchema),
  ]).optional(),
});

/** Environment variables required by the agent runtime. */
export type AgentEnv = {
  ASSEMBLYAI_API_KEY: string;
  LLM_MODEL?: string;
  [key: string]: string | undefined;
};

/** Zod schema for {@linkcode AgentEnv}. */
export const EnvSchema: z.ZodType<AgentEnv> = z.object({
  ASSEMBLYAI_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().optional(),
}).catchall(z.string());

/** Config returned by the worker via Comlink RPC. */
export type WorkerConfig = {
  config: AgentConfig;
  toolSchemas: ToolSchema[];
};

/** Zod schema for {@linkcode WorkerConfig}. */
export const WorkerConfigSchema: z.ZodType<WorkerConfig> = z.object({
  config: AgentConfigSchema,
  toolSchemas: z.array(ToolSchemaSchema),
});

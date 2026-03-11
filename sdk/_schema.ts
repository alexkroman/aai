import { z } from "zod";

export type Transport = "websocket" | "twilio";

export const TransportSchema: z.ZodType<Transport> = z.enum([
  "websocket",
  "twilio",
]);

export function normalizeTransport(
  value: Transport | Transport[] | undefined,
): Transport[] {
  if (value === undefined) return ["websocket"];
  if (typeof value === "string") return [value];
  return value;
}

export type BuiltinTool =
  | "web_search"
  | "visit_webpage"
  | "fetch_json"
  | "run_code";

export const BuiltinToolSchema: z.ZodType<BuiltinTool> = z.enum([
  "web_search",
  "visit_webpage",
  "fetch_json",
  "run_code",
]);

export type ToolChoice =
  | "auto"
  | "required"
  | "none"
  | { type: "tool"; toolName: string };

export const ToolChoiceSchema: z.ZodType<ToolChoice> = z.union([
  z.enum(["auto", "required", "none"]),
  z.object({ type: z.literal("tool"), toolName: z.string().min(1) }),
]);

export type AgentConfig = {
  name: string;
  instructions: string;
  greeting: string;
  voice: string;
  sttPrompt?: string;
  maxSteps?: number;
  toolChoice?: ToolChoice;
  transport?: Transport | Transport[];
  builtinTools?: BuiltinTool[];
};

export const AgentConfigSchema: z.ZodType<AgentConfig> = z.object({
  name: z.string().min(1),
  instructions: z.string().min(1),
  greeting: z.string().min(1),
  voice: z.string().min(1),
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

export const ToolSchemaSchema: z.ZodType<ToolSchema> = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  parameters: z.object({
    type: z.literal("object"),
    properties: z.record(z.string(), z.unknown()).optional(),
    required: z.array(z.string()).optional(),
  }).catchall(z.unknown()),
});

export type DeployBody = {
  env: Record<string, string>;
  worker: string;
  client: string;
  transport?: Transport | Transport[];
};

export const DeployBodySchema: z.ZodType<DeployBody> = z.object({
  env: z.record(z.string(), z.string()),
  worker: z.string().min(1).max(10_000_000),
  client: z.string().min(1).max(10_000_000),
  transport: z.union([
    TransportSchema,
    z.array(TransportSchema),
  ]).optional(),
});

export type AgentEnv = {
  ASSEMBLYAI_API_KEY: string;
  [key: string]: string | undefined;
};

export const EnvSchema: z.ZodType<AgentEnv> = z.object({
  ASSEMBLYAI_API_KEY: z.string().min(1),
}).catchall(z.string());

/** Config returned by the worker via Comlink RPC. */
export type WorkerConfig = {
  config: AgentConfig;
  toolSchemas: ToolSchema[];
};

export const WorkerConfigSchema: z.ZodType<WorkerConfig> = z.object({
  config: AgentConfigSchema,
  toolSchemas: z.array(ToolSchemaSchema),
});

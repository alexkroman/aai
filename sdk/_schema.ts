import { z } from "zod";

// ── Transport ───────────────────────────────────────────────────

export type Transport = "websocket" | "twilio";

/** Normalize a transport field value into an array. */
export function normalizeTransport(
  value: Transport | Transport[] | undefined,
): Transport[] {
  if (value === undefined) return ["websocket"];
  if (typeof value === "string") return [value];
  return value;
}

const TransportSchema = z.enum(["websocket", "twilio"]);

const TransportFieldSchema = z.union([
  TransportSchema,
  z.array(TransportSchema),
]).optional();

// ── Deploy request body ─────────────────────────────────────────

export type DeployBody = {
  env: Record<string, string>;
  worker: string;
  client: string;
  transport?: Transport | Transport[];
  config?: {
    name?: string;
    instructions: string;
    greeting: string;
    voice: string;
    prompt?: string;
    builtinTools?: string[];
  };
  toolSchemas?: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }[];
};

export const DeployBodySchema: z.ZodType<DeployBody> = z.object({
  env: z.record(z.string(), z.string()),
  worker: z.string().min(1),
  client: z.string().min(1),
  transport: TransportFieldSchema,
  config: z.object({
    name: z.string().optional(),
    instructions: z.string(),
    greeting: z.string(),
    voice: z.string(),
    prompt: z.string().optional(),
    builtinTools: z.array(z.string()).optional(),
  }).optional(),
  toolSchemas: z.array(z.object({
    name: z.string(),
    description: z.string(),
    parameters: z.record(z.string(), z.unknown()),
  })).optional(),
});

// ── Agent environment variables ─────────────────────────────────

export type AgentEnv = {
  ASSEMBLYAI_API_KEY: string;
  LLM_MODEL?: string;
  [key: string]: unknown;
};

export const EnvSchema: z.ZodType<AgentEnv> = z.object({
  ASSEMBLYAI_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().optional(),
}).passthrough();

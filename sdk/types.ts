import { z } from "zod";
import type { BuiltinTool, ToolSchema, Transport } from "./_schema.ts";
import type { Kv } from "./kv.ts";
export type { AgentConfig, BuiltinTool } from "./_schema.ts";

export type ToolContext<S = Record<string, unknown>> = {
  sessionId: string;
  env: Record<string, string>;
  abortSignal?: AbortSignal;
  state: S;
  kv: Kv;
};

export type HookContext<S = Record<string, unknown>> = {
  sessionId: string;
  env: Record<string, string>;
  state: S;
  kv: Kv;
};

// deno-lint-ignore no-explicit-any
export type ToolDef<P extends z.ZodObject<z.ZodRawShape> = any> = {
  description: string;
  parameters?: P;
  execute: (
    args: z.infer<P>,
    ctx: ToolContext,
  ) => Promise<unknown> | unknown;
};

/** Helper that infers typed args from a Zod schema. */
export function tool<P extends z.ZodObject<z.ZodRawShape>>(def: {
  description: string;
  parameters: P;
  execute: (
    args: z.infer<P>,
    ctx: ToolContext,
  ) => Promise<unknown> | unknown;
}): ToolDef<P>;
export function tool(def: {
  description: string;
  execute: (
    // deno-lint-ignore no-explicit-any
    args: any,
    ctx: ToolContext,
  ) => Promise<unknown> | unknown;
}): ToolDef;
export function tool(def: ToolDef): ToolDef {
  return def;
}

export type Voice =
  | "luna"
  | "andromeda"
  | "celeste"
  | "orion"
  | "sirius"
  | "lyra"
  | "estelle"
  | "esther"
  | "kima"
  | "bond"
  | "thalassa"
  | "vespera"
  | "moss"
  | "fern"
  | "astra"
  | "tauro"
  | "walnut"
  | "arcana"
  | (string & Record<never, never>);

// deno-lint-ignore no-explicit-any
export type AgentOptions<S = any> = {
  name: string;
  env?: string[];
  transport?: Transport | Transport[];
  instructions?: string;
  greeting?: string;
  voice?: Voice;
  sttPrompt?: string;
  stopWhen?: number;
  builtinTools?: BuiltinTool[];
  tools?: Record<string, ToolDef>;
  state?: () => S;
  onConnect?: (ctx: HookContext<S>) => void | Promise<void>;
  onDisconnect?: (ctx: HookContext<S>) => void | Promise<void>;
  onError?: (error: Error, ctx?: HookContext<S>) => void;
  onTurn?: (text: string, ctx: HookContext<S>) => void | Promise<void>;
};

export const DEFAULT_INSTRUCTIONS: string = `\
You are a helpful voice assistant. Your goal is to provide accurate, \
research-backed answers using your available tools.

Voice-First Rules:
- Optimize for natural speech. Avoid jargon unless central to the answer. \
Use short, punchy sentences.
- Never mention "search results," "sources," or "the provided text." \
Speak as if the knowledge is your own.
- No visual formatting. Do not say "bullet point," "bold," or "bracketed one." \
If you need to list items, say "First," "Next," and "Finally."
- Start with the most important information. No introductory filler.
- Be concise. Keep answers to 1-3 sentences. For complex topics, provide a high-level summary.
- Be confident. Avoid hedging phrases like "It seems that" or "I believe."
- If you don't have enough information, say so directly rather than guessing.
- Never use exclamation points. Keep your tone calm and conversational.`;

export const DEFAULT_GREETING: string =
  "Hey there. I'm a voice assistant. What can I help you with?";

const EMPTY_PARAMS = z.object({});

export function agentToolsToSchemas(
  tools: Readonly<Record<string, ToolDef>>,
): ToolSchema[] {
  return Object.entries(tools).map(([name, def]) => ({
    name,
    description: def.description,
    parameters: z.toJSONSchema(def.parameters ?? EMPTY_PARAMS),
  }));
}

export type AgentDef = {
  readonly name: string;
  readonly env: readonly string[];
  readonly transport: readonly Transport[];
  readonly instructions: string;
  readonly greeting: string;
  readonly voice: string;
  readonly sttPrompt?: string;
  readonly stopWhen: number;
  readonly builtinTools?: readonly BuiltinTool[];
  readonly tools: Readonly<Record<string, ToolDef>>;
  readonly state?: () => unknown;
  readonly onConnect?: AgentOptions["onConnect"];
  readonly onDisconnect?: AgentOptions["onDisconnect"];
  readonly onError?: AgentOptions["onError"];
  readonly onTurn?: AgentOptions["onTurn"];
};

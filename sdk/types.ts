/**
 * Core type definitions for the AAI agent SDK.
 *
 * @module
 */

import { z } from "zod";
import type {
  AgentMode,
  BuiltinTool,
  ToolChoice,
  ToolSchema,
  Transport,
} from "./_schema.ts";
import type { Kv } from "./kv.ts";
export type {
  AgentConfig,
  AgentMode,
  BuiltinTool,
  ToolChoice,
} from "./_schema.ts";

/** A single message in the conversation history. */
export type Message = {
  role: "user" | "assistant" | "tool";
  content: string;
};

/** Context passed to tool `execute` functions. */
export type ToolContext<S = Record<string, unknown>> = {
  /** Unique identifier for the current session. */
  sessionId: string;
  /** Environment variables declared in the agent config. */
  env: Record<string, string>;
  /** Signal that aborts when the tool execution times out. */
  abortSignal?: AbortSignal;
  /** Mutable per-session state created by the agent's `state` factory. */
  state: S;
  /** Key-value store scoped to this agent deployment. */
  kv: Kv;
  /** Read-only snapshot of conversation messages so far. */
  messages: readonly Message[];
};

/** Context passed to lifecycle hooks (`onConnect`, `onTurn`, etc.). */
export type HookContext<S = Record<string, unknown>> = {
  /** Unique identifier for the current session. */
  sessionId: string;
  /** Environment variables declared in the agent config. */
  env: Record<string, string>;
  /** Mutable per-session state created by the agent's `state` factory. */
  state: S;
  /** Key-value store scoped to this agent deployment. */
  kv: Kv;
};

/** Definition of a custom tool that the agent can invoke. */
// deno-lint-ignore no-explicit-any
export type ToolDef<P extends z.ZodObject<z.ZodRawShape> = any> = {
  /** Human-readable description shown to the LLM. */
  description: string;
  /** Zod schema for the tool's parameters. */
  parameters?: P;
  /** Function that executes the tool and returns a result. */
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

/** Available TTS voice identifiers. */
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

/** Information about a completed agentic step, passed to `onStep`. */
export type StepInfo = {
  /** 1-based step index within the current turn. */
  stepNumber: number;
  /** Tool calls made during this step. */
  toolCalls: { toolName: string; args: Record<string, unknown> }[];
  /** LLM text output for this step. */
  text: string;
};

/** Options passed to {@linkcode defineAgent} to configure an agent. */
// deno-lint-ignore no-explicit-any
export type AgentOptions<S = any> = {
  /** Display name for the agent. */
  name: string;
  /** Operating mode: `"full"` (default) or `"stt-only"`. */
  mode?: AgentMode;
  /** Environment variable names the agent requires at deploy time. */
  env?: string[];
  /** Transport(s) the agent supports: `"websocket"` and/or `"twilio"`. */
  transport?: Transport | Transport[];
  /** System prompt for the LLM. */
  instructions?: string;
  /** Initial spoken greeting when a session starts. */
  greeting?: string;
  /** TTS voice to use. */
  voice?: Voice;
  /** Prompt hint for the STT model to improve transcription accuracy. */
  sttPrompt?: string;
  /** Maximum agentic loop iterations per turn. */
  maxSteps?: number | ((ctx: HookContext<S>) => number);
  /** How the LLM should choose tools. */
  toolChoice?: ToolChoice;
  /** Built-in tools to enable (e.g. `"web_search"`, `"run_code"`). */
  builtinTools?: BuiltinTool[];
  /** Custom tools the agent can invoke. */
  tools?: Record<string, ToolDef>;
  /** Factory that creates fresh per-session state. */
  state?: () => S;
  /** Called when a new session connects. */
  onConnect?: (ctx: HookContext<S>) => void | Promise<void>;
  /** Called when a session disconnects. */
  onDisconnect?: (ctx: HookContext<S>) => void | Promise<void>;
  /** Called when an unhandled error occurs. */
  onError?: (error: Error, ctx?: HookContext<S>) => void;
  /** Called after a complete turn (all steps finished). */
  onTurn?: (text: string, ctx: HookContext<S>) => void | Promise<void>;
  /** Called after each agentic step completes. */
  onStep?: (step: StepInfo, ctx: HookContext<S>) => void | Promise<void>;
  /** Called before each step; can restrict which tools are active. */
  onBeforeStep?: (
    stepNumber: number,
    ctx: HookContext<S>,
  ) =>
    | { activeTools?: string[] }
    | void
    | Promise<{ activeTools?: string[] } | void>;
};

/** Default system prompt used when `instructions` is not provided. */
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

/** Default greeting spoken when a session starts. */
export const DEFAULT_GREETING: string =
  "Hey there. I'm a voice assistant. What can I help you with?";

const EMPTY_PARAMS = z.object({});

/** Convert agent tool definitions to JSON Schema format for wire transport. */
export function agentToolsToSchemas(
  tools: Readonly<Record<string, ToolDef>>,
): ToolSchema[] {
  return Object.entries(tools).map(([name, def]) => ({
    name,
    description: def.description,
    parameters: z.toJSONSchema(
      def.parameters ?? EMPTY_PARAMS,
    ) as ToolSchema["parameters"],
  }));
}

/** Frozen agent definition returned by {@linkcode defineAgent}. */
export type AgentDef = {
  readonly name: string;
  readonly mode: AgentMode;
  readonly env: readonly string[];
  readonly transport: readonly Transport[];
  readonly instructions: string;
  readonly greeting: string;
  readonly voice: string;
  readonly sttPrompt?: string;
  readonly maxSteps: number | ((ctx: HookContext) => number);
  readonly toolChoice?: ToolChoice;
  readonly builtinTools?: readonly BuiltinTool[];
  readonly tools: Readonly<Record<string, ToolDef>>;
  readonly state?: () => unknown;
  readonly onConnect?: AgentOptions["onConnect"];
  readonly onDisconnect?: AgentOptions["onDisconnect"];
  readonly onError?: AgentOptions["onError"];
  readonly onTurn?: AgentOptions["onTurn"];
  readonly onStep?: AgentOptions["onStep"];
  readonly onBeforeStep?: AgentOptions["onBeforeStep"];
};

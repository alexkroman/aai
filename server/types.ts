import { z } from "zod";
import {
  DEFAULT_STT_SAMPLE_RATE,
  DEFAULT_TTS_SAMPLE_RATE,
} from "./protocol.ts";

// --- Agent types (merged from agent_types.ts) ---

export interface ToolContext {
  secrets: Record<string, string>;
  fetch: typeof globalThis.fetch;
  signal?: AbortSignal;
}

/** JSON Schema property definition. */
export interface JSONSchemaProperty {
  type?: string;
  description?: string;
  enum?: (string | number | boolean)[];
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  [key: string]: unknown;
}

/** JSON Schema object describing tool parameters. Must have type "object". */
export interface ToolParameters {
  type: "object";
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
  [key: string]: unknown;
}

export interface ToolDef {
  description: string;
  parameters: ToolParameters;
  // deno-lint-ignore no-explicit-any
  execute: (args: any, ctx: ToolContext) => Promise<unknown> | unknown;
}

/** Built-in tools provided by the framework. */
export type BuiltinTool =
  | "web_search"
  | "visit_webpage"
  | "fetch_json"
  | "run_code"
  | "user_input"
  | "final_answer";

/**
 * Rime TTS voice ID. Popular voices listed for autocomplete;
 * any valid Rime speaker ID is accepted.
 * Full catalog: https://docs.rime.ai/api-reference/voices
 */
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
  // deno-lint-ignore ban-types
  | (string & {});

export interface AgentOptions {
  name: string;
  instructions?: string;
  greeting?: string;
  voice?: Voice;
  prompt?: string;
  builtinTools?: BuiltinTool[];
  tools?: Record<string, ToolDef>;
  onConnect?: (ctx: { sessionId: string }) => void | Promise<void>;
  onDisconnect?: (ctx: { sessionId: string }) => void | Promise<void>;
  onError?: (error: Error, ctx?: { sessionId: string }) => void;
  onTurn?: (text: string, ctx: { sessionId: string }) => void | Promise<void>;
}

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

export interface ToolSchema {
  name: string;
  description: string;
  parameters: ToolParameters;
}

export function agentToolsToSchemas(
  tools: Readonly<Record<string, ToolDef>>,
): ToolSchema[] {
  return Object.entries(tools).map(([name, def]) => ({
    name,
    description: def.description,
    parameters: def.parameters,
  }));
}

// --- Config types ---

export interface STTConfig {
  sampleRate: number;
  speechModel: string;
  wssBase: string;
  tokenExpiresIn: number;
  formatTurns: boolean;
  minEndOfTurnSilenceWhenConfident: number;
  maxTurnSilence: number;
  vadThreshold: number;
  prompt?: string;
}

export const DEFAULT_STT_CONFIG: STTConfig = {
  sampleRate: DEFAULT_STT_SAMPLE_RATE,
  speechModel: "u3-pro",
  wssBase: "wss://streaming.assemblyai.com/v3/ws",
  tokenExpiresIn: 480,
  formatTurns: true,
  minEndOfTurnSilenceWhenConfident: 100,
  maxTurnSilence: 1000,
  vadThreshold: 0.3,
};

export interface TTSConfig {
  wssUrl: string;
  apiKey: string;
  voice: string;
  modelId: string;
  audioFormat: string;
  samplingRate: number;
  sampleRate: number;
}

export const DEFAULT_TTS_CONFIG: TTSConfig = {
  wssUrl: "wss://users-ws.rime.ai/ws",
  apiKey: "",
  voice: "luna",
  modelId: "arcana",
  audioFormat: "pcm",
  samplingRate: DEFAULT_TTS_SAMPLE_RATE,
  sampleRate: DEFAULT_TTS_SAMPLE_RATE,
};

export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

// --- STT message types ---

export interface SttMessage {
  type: string;
  transcript?: string;
  is_final?: boolean;
  turn_is_formatted?: boolean;
  turn_order?: number;
  end_of_turn?: boolean;
  timestamp?: number;
  audio_duration_seconds?: number;
  session_duration_seconds?: number;
  [key: string]: unknown;
}

export const SttMessageSchema: z.ZodType<SttMessage> = z
  .object({
    type: z.string(),
    transcript: z.string().optional(),
    is_final: z.boolean().optional(),
    turn_is_formatted: z.boolean().optional(),
    turn_order: z.number().optional(),
    end_of_turn: z.boolean().optional(),
    timestamp: z.number().optional(),
    audio_duration_seconds: z.number().optional(),
    session_duration_seconds: z.number().optional(),
  })
  .passthrough();

// --- LLM types ---

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string; [key: string]: unknown };
    [key: string]: unknown;
  }[];
  tool_call_id?: string;
  [key: string]: unknown;
}

const ChatMessageSchema: z.ZodType<ChatMessage> = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string().nullable(),
  tool_calls: z.array(
    z.object({
      id: z.string(),
      type: z.literal("function"),
      function: z.object({ name: z.string(), arguments: z.string() })
        .passthrough(),
    }).passthrough(),
  ).optional(),
  tool_call_id: z.string().optional(),
}).passthrough();

export interface LLMResponse {
  id?: string;
  choices: { index?: number; message: ChatMessage; finish_reason: string }[];
  [key: string]: unknown;
}

export const LLMResponseSchema: z.ZodType<LLMResponse> = z
  .object({
    id: z.string().optional(),
    choices: z.array(z.object({
      index: z.number().optional(),
      message: ChatMessageSchema,
      finish_reason: z.string(),
    })).nullable().transform((v) => v ?? []),
  })
  .passthrough();

// --- Agent config (used by worker/session) ---

export interface AgentConfig {
  name?: string;
  instructions: string;
  greeting: string;
  voice: string;
  prompt?: string;
  builtinTools?: string[];
}

/**
 * AAI SDK — build voice agents powered by STT, LLM, and TTS.
 *
 * @example
 * ```ts
 * import { defineAgent, tool, z } from "@aai/sdk";
 *
 * export default defineAgent({
 *   name: "my-agent",
 *   instructions: "You are a helpful voice assistant.",
 *   tools: {
 *     greet: tool({
 *       description: "Greet the user by name",
 *       parameters: z.object({ name: z.string() }),
 *       execute: ({ name }) => `Hello, ${name}!`,
 *     }),
 *   },
 * });
 * ```
 *
 * @module
 */

export { defineAgent } from "./define_agent.ts";
export { fetchJSON, httpError } from "./fetch_json.ts";
export { createMemoryKv } from "./kv.ts";
export { kvTools } from "./kv_tools.ts";
export { z } from "zod";
export { tool } from "./types.ts";
export type {
  AgentDef,
  AgentMode,
  AgentOptions,
  BuiltinTool,
  HookContext,
  Message,
  StepInfo,
  ToolChoice,
  ToolContext,
  ToolDef,
  Voice,
} from "./types.ts";
export type { Kv, KvEntry, KvListOptions } from "./kv.ts";
export type { KvToolsOptions } from "./kv_tools.ts";
export type { Transport } from "./_schema.ts";

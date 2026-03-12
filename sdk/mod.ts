// Copyright 2025 the AAI authors. MIT license.
/**
 * AAI SDK — build voice agents powered by STT, LLM, and TTS.
 *
 * @example
 * ```ts
 * import { defineAgent, z } from "@aai/sdk";
 *
 * export default defineAgent({
 *   name: "my-agent",
 *   instructions: "You are a helpful voice assistant.",
 *   tools: {
 *     greet: {
 *       description: "Greet the user by name",
 *       parameters: z.object({ name: z.string() }),
 *       execute: ({ name }) => `Hello, ${name}!`,
 *     },
 *   },
 * });
 * ```
 *
 * @module
 */

export { defineAgent } from "./define_agent.ts";
export { createMemoryKv } from "./kv.ts";
export { kvTools } from "./kv_tools.ts";

/**
 * Re-export of the Zod schema library for defining tool parameters.
 *
 * @example
 * ```ts
 * import { z } from "@aai/sdk";
 *
 * const params = z.object({
 *   query: z.string().describe("Search query"),
 *   limit: z.number().optional(),
 * });
 * ```
 */
export { z } from "zod";
export type {
  AgentOptions,
  HookContext,
  Message,
  ToolContext,
  ToolDef,
} from "./types.ts";

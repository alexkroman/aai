import { normalizeTransport } from "./_schema.ts";
import {
  type AgentDef,
  type AgentOptions,
  DEFAULT_GREETING,
  DEFAULT_INSTRUCTIONS,
} from "./types.ts";

/** Derive a URL-safe slug from an agent name. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Create a voice agent definition with sensible defaults.
 *
 * @example
 * ```ts
 * export default defineAgent({
 *   name: "Scout",
 *   voice: "tara",
 *   instructions: "...",
 * });
 * ```
 */
export function defineAgent(options: AgentOptions): AgentDef {
  return Object.freeze({
    name: options.name,
    slug: options.slug || slugify(options.name),
    env: Object.freeze(options.env ?? ["ASSEMBLYAI_API_KEY"]),
    transport: Object.freeze(normalizeTransport(options.transport)),
    instructions: options.instructions ?? DEFAULT_INSTRUCTIONS,
    greeting: options.greeting ?? DEFAULT_GREETING,
    voice: options.voice ?? "luna",
    prompt: options.prompt,
    builtinTools: options.builtinTools,
    tools: options.tools ?? {},
    onConnect: options.onConnect,
    onDisconnect: options.onDisconnect,
    onError: options.onError,
    onTurn: options.onTurn,
  });
}

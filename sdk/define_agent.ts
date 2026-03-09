import { normalizeTransport } from "./_schema.ts";
import {
  type AgentDef,
  type AgentOptions,
  DEFAULT_GREETING,
  DEFAULT_INSTRUCTIONS,
  normalizeToolDef,
  type ToolDef,
} from "./types.ts";

export function defineAgent(options: AgentOptions): AgentDef {
  const tools: Record<string, ToolDef> = {};
  for (const [name, input] of Object.entries(options.tools ?? {})) {
    tools[name] = normalizeToolDef(input);
  }

  return Object.freeze({
    name: options.name,
    env: Object.freeze(options.env ?? ["ASSEMBLYAI_API_KEY"]),
    transport: Object.freeze(normalizeTransport(options.transport)),
    instructions: options.instructions ?? DEFAULT_INSTRUCTIONS,
    greeting: options.greeting ?? DEFAULT_GREETING,
    voice: options.voice ?? "luna",
    prompt: options.prompt,
    builtinTools: options.builtinTools,
    tools,
    state: options.state,
    onConnect: options.onConnect,
    onDisconnect: options.onDisconnect,
    onError: options.onError,
    onTurn: options.onTurn,
  });
}

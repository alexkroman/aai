// Re-export everything from types.ts for backwards compatibility.
// This file can be removed once all consumers import from types.ts directly.
export {
  type AgentOptions,
  agentToolsToSchemas,
  type BuiltinTool,
  DEFAULT_GREETING,
  DEFAULT_INSTRUCTIONS,
  type JSONSchemaProperty,
  type ToolContext,
  type ToolDef,
  type ToolParameters,
  type ToolSchema,
  type Voice,
} from "./types.ts";

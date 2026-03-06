import { getLogger } from "./logger.ts";
import type { ToolContext, ToolDef, ToolParameters } from "./agent_types.ts";

const log = getLogger("tool-executor");
export const TOOL_HANDLER_TIMEOUT = 30_000;

export type ExecuteTool = (
  name: string,
  args: Record<string, unknown>,
) => Promise<string>;

/** Lightweight JSON Schema validation for tool parameters. */
function validateArgs(
  params: ToolParameters,
  args: Record<string, unknown>,
): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  const errors: string[] = [];
  for (const key of params.required ?? []) {
    if (!(key in args) || args[key] === undefined) {
      errors.push(`${key}: required`);
    }
  }
  for (const [key, value] of Object.entries(args)) {
    const schema = params.properties[key];
    if (!schema) continue;
    if (schema.type && typeof value !== schema.type && value !== undefined) {
      // Allow "number" type for actual numbers
      if (!(schema.type === "number" && typeof value === "number")) {
        errors.push(`${key}: expected ${schema.type}`);
      }
    }
  }
  if (errors.length > 0) return { ok: false, error: errors.join(", ") };
  return { ok: true, data: args };
}

export async function executeToolCall(
  name: string,
  args: Record<string, unknown>,
  tool: ToolDef,
  secrets: Record<string, string>,
): Promise<string> {
  const result = validateArgs(tool.parameters, args);
  if (!result.ok) {
    return `Error: Invalid arguments for tool "${name}": ${result.error}`;
  }

  try {
    const signal = AbortSignal.timeout(TOOL_HANDLER_TIMEOUT);
    const ctx: ToolContext = {
      secrets: { ...secrets },
      fetch: globalThis.fetch,
      signal,
    };
    const value = await Promise.resolve(
      tool.execute(result.data, ctx),
    );
    if (value == null) return "null";
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      log.warn("Tool execution timed out", { tool: name });
      return `Error: Tool "${name}" timed out after ${TOOL_HANDLER_TIMEOUT}ms`;
    }
    log.warn("Tool execution failed", { err, tool: name });
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

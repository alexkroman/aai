import { z } from "zod";
import { getLogger } from "./logger.ts";
import type { ToolContext, ToolDef } from "./agent_types.ts";

const log = getLogger("tool-executor");
export const TOOL_HANDLER_TIMEOUT = 30_000;

type JSONSchemaParam = Parameters<typeof z.fromJSONSchema>[0];

export type ExecuteTool = (
  name: string,
  args: Record<string, unknown>,
) => Promise<string>;

export async function executeToolCall(
  name: string,
  args: Record<string, unknown>,
  tool: ToolDef,
  secrets: Record<string, string>,
): Promise<string> {
  const validator = z.fromJSONSchema(tool.parameters as JSONSchemaParam);
  const parsed = validator.safeParse(args);
  if (!parsed.success) {
    // deno-lint-ignore no-explicit-any
    const issues = ((parsed as any).error?.issues ?? [])
      .map((i: { path: (string | number)[]; message: string }) =>
        `${i.path.join(".")}: ${i.message}`
      ).join(", ");
    return `Error: Invalid arguments for tool "${name}": ${issues}`;
  }

  try {
    const signal = AbortSignal.timeout(TOOL_HANDLER_TIMEOUT);
    const ctx: ToolContext = {
      secrets: { ...secrets },
      fetch: globalThis.fetch,
      signal,
    };
    const result = await Promise.resolve(
      tool.execute(parsed.data as Record<string, unknown>, ctx),
    );
    if (result == null) return "null";
    return typeof result === "string" ? result : JSON.stringify(result);
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      log.warn("Tool execution timed out", { tool: name });
      return `Error: Tool "${name}" timed out after ${TOOL_HANDLER_TIMEOUT}ms`;
    }
    log.warn("Tool execution failed", { err, tool: name });
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

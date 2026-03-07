import { z } from "zod";
import type { ToolContext, ToolDef } from "../sdk/types.ts";

export const TOOL_HANDLER_TIMEOUT = 30_000;

export type ExecuteTool = (
  name: string,
  args: Record<string, unknown>,
  sessionId?: string,
) => Promise<string>;

export async function executeToolCall(
  name: string,
  args: Record<string, unknown>,
  tool: ToolDef,
  env: Record<string, string>,
  sessionId?: string,
): Promise<string> {
  const schema = tool.parameters ?? z.object({});
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    const issues = (parsed.error?.issues ?? [])
      .map((i) => `${i.path.map(String).join(".")}: ${i.message}`)
      .join(", ");
    return `Error: Invalid arguments for tool "${name}": ${issues}`;
  }

  try {
    const signal = AbortSignal.timeout(TOOL_HANDLER_TIMEOUT);
    const ctx: ToolContext = {
      sessionId: sessionId ?? "",
      env: { ...env },
      signal,
    };
    const result = await Promise.resolve(
      tool.execute(parsed.data as Record<string, unknown>, ctx),
    );
    if (result == null) return "null";
    return typeof result === "string" ? result : JSON.stringify(result);
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      console.warn(`[tool-executor] Tool execution timed out: ${name}`);
      return `Error: Tool "${name}" timed out after ${TOOL_HANDLER_TIMEOUT}ms`;
    }
    console.warn(`[tool-executor] Tool execution failed: ${name}`, err);
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

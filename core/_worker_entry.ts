import type { AgentOptions, HookContext, ToolDef } from "../sdk/types.ts";
import { executeToolCall } from "./_tool_executor.ts";
import { type MessageTarget, serveRpc } from "./_rpc.ts";

interface AgentLike {
  readonly tools: Readonly<Record<string, ToolDef>>;
  readonly onConnect?: AgentOptions["onConnect"];
  readonly onDisconnect?: AgentOptions["onDisconnect"];
  readonly onError?: AgentOptions["onError"];
  readonly onTurn?: AgentOptions["onTurn"];
}

export interface WorkerApi {
  executeTool(
    name: string,
    args: Record<string, unknown>,
    sessionId?: string,
    timeoutMs?: number,
  ): Promise<string>;
  invokeHook(
    hook: string,
    sessionId: string,
    extra?: { text?: string; error?: string },
    timeoutMs?: number,
  ): Promise<void>;
}

export function startWorker(
  agent: AgentLike,
  env: Record<string, string>,
  endpoint?: MessageTarget,
): void {
  const toolHandlers = new Map(Object.entries(agent.tools));

  const port: MessageTarget = endpoint ?? self as unknown as MessageTarget;

  serveRpc(port, {
    executeTool: ({ name, args, sessionId }: Record<string, unknown>) => {
      const tool = toolHandlers.get(name as string);
      if (!tool) return `Error: Unknown tool "${name}"`;
      return executeToolCall(
        name as string,
        args as Record<string, unknown>,
        tool,
        env,
        sessionId as string | undefined,
      );
    },

    invokeHook: async ({
      hook,
      sessionId,
      text,
      error,
    }: Record<string, unknown>) => {
      const ctx: HookContext = {
        sessionId: sessionId as string,
        env: { ...env },
      };
      if (hook === "onConnect") {
        await agent.onConnect?.(ctx);
      } else if (hook === "onDisconnect") {
        await agent.onDisconnect?.(ctx);
      } else if (hook === "onTurn" && text !== undefined) {
        await agent.onTurn?.(text as string, ctx);
      } else if (hook === "onError" && error !== undefined) {
        agent.onError?.(new Error(error as string), ctx);
      }
    },
  });
}

import type { WorkerApi } from "../core/_worker_entry.ts";
import { createRpcCaller, type MessageTarget } from "../core/_rpc.ts";

export function createWorkerRpc(
  port: Worker | MessagePort | MessageTarget,
): WorkerApi {
  const call = createRpcCaller(port);
  return {
    executeTool: async (
      name: string,
      args: Record<string, unknown>,
      sessionId?: string,
      timeoutMs?: number,
    ): Promise<string> => {
      const raw = await call(
        "executeTool",
        { name, args, sessionId },
        timeoutMs,
      );
      return typeof raw === "string" ? raw : String(raw ?? "");
    },
    invokeHook: async (
      hook: string,
      sessionId: string,
      extra?: { text?: string; error?: string },
      timeoutMs?: number,
    ): Promise<void> => {
      await call("invokeHook", { hook, sessionId, ...extra }, timeoutMs);
    },
  };
}

export interface SandboxApi {
  execute(
    code: string,
    timeoutMs?: number,
  ): Promise<{ output: string; error?: string }>;
}

export function createSandboxRpc(port: Worker | MessagePort): SandboxApi {
  const call = createRpcCaller(port);
  return {
    execute: (code, timeoutMs?) =>
      call("execute", { code }, timeoutMs) as Promise<
        { output: string; error?: string }
      >,
  };
}

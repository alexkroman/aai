import type { AgentConfig, ToolSchema } from "../sdk/types.ts";
import type { WorkerApi } from "../core/_worker_entry.ts";
import { createRpcCaller } from "../core/_rpc.ts";
import { GetConfigResponseSchema } from "../core/_rpc_schema.ts";

/** Spawn a local Deno Worker from bundled code and return a WorkerApi. */
export function spawnLocalWorker(
  workerCode: string,
  slug: string,
): { workerApi: WorkerApi; terminate: () => void } {
  const workerUrl = `data:application/javascript;base64,${btoa(workerCode)}`;

  // deno-lint-ignore no-explicit-any
  const worker = new (Worker as any)(workerUrl, {
    type: "module",
    name: `dev-${slug}`,
    deno: {
      permissions: {
        net: true,
        read: false,
        env: false,
        run: false,
        write: false,
        ffi: false,
        sys: false,
      },
    },
  });

  const call = createRpcCaller(worker);

  const workerApi: WorkerApi = {
    async getConfig(
      timeoutMs?: number,
    ): Promise<{ config: AgentConfig; toolSchemas: ToolSchema[] }> {
      const raw = await call("getConfig", undefined, timeoutMs);
      return GetConfigResponseSchema.parse(raw) as {
        config: AgentConfig;
        toolSchemas: ToolSchema[];
      };
    },
    async executeTool(
      name: string,
      args: Record<string, unknown>,
      sessionId?: string,
      timeoutMs?: number,
    ): Promise<string> {
      const raw = await call(
        "executeTool",
        { name, args, sessionId },
        timeoutMs,
      );
      return typeof raw === "string" ? raw : String(raw ?? "");
    },
    async invokeHook(
      hook: string,
      sessionId: string,
      extra?: { text?: string; error?: string },
      timeoutMs?: number,
    ): Promise<void> {
      await call("invokeHook", { hook, sessionId, ...extra }, timeoutMs);
    },
  };

  return {
    workerApi,
    terminate: () => worker.terminate(),
  };
}

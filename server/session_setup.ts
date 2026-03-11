import type { AgentConfig } from "@aai/sdk/types";
import type { ToolSchema } from "@aai/sdk/schema";
import type { ExecuteTool, WorkerApi } from "@aai/core/worker-entry";
import type { AgentSlot } from "./worker_pool.ts";
import { createToolExecutor, ensureAgent } from "./worker_pool.ts";
import { loadPlatformConfig, type PlatformConfig } from "./config.ts";
import { getBuiltinToolSchemas } from "./builtin_tools.ts";
import type { BundleStore } from "./bundle_store_tigris.ts";
import type { KvStore } from "./kv.ts";

export type SessionSetup = {
  agentConfig: AgentConfig;
  toolSchemas: ToolSchema[];
  platformConfig: PlatformConfig;
  executeTool: ExecuteTool;
  getWorkerApi?: () => Promise<WorkerApi>;
  env?: Record<string, string | undefined>;
};

export function prepareSession(
  slot: AgentSlot,
  slug: string,
  store: BundleStore,
  kvStore: KvStore,
): SessionSetup {
  const config = slot.config!;
  const builtinTools = getBuiltinToolSchemas(config.builtinTools ?? []);
  const toolSchemas = [...(slot.toolSchemas ?? []), ...builtinTools];
  const kvCtx = slot.ownerHash
    ? { kvStore, scope: { ownerHash: slot.ownerHash, slug } }
    : undefined;
  const { executeTool, getWorkerApi } = createToolExecutor(
    slot,
    store,
    kvCtx,
  );

  // Eagerly spawn worker if custom tools are configured
  if ((slot.toolSchemas ?? []).length > 0 && !slot._dev) {
    const getWorkerCode = (s: string) => store.getFile(s, "worker");
    ensureAgent(slot, getWorkerCode, kvCtx).catch(() => {
      /* will retry on first tool call */
    });
  }

  return {
    agentConfig: config,
    toolSchemas,
    platformConfig: loadPlatformConfig(slot.env),
    executeTool,
    getWorkerApi,
    env: slot.env,
  };
}

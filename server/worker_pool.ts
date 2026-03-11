import { encodeBase64 } from "@std/encoding/base64";
import { loadPlatformConfig } from "./config.ts";
import type { AgentConfig } from "@aai/sdk/types";
import type { ToolSchema } from "@aai/sdk/schema";
import {
  createWorkerApi,
  type HostApi,
  type WorkerApi,
} from "@aai/core/worker-entry";
import type { ExecuteTool } from "@aai/core/worker-entry";
import type { BundleStore } from "./bundle_store_tigris.ts";
import type { AgentMetadata } from "@aai/core/rpc-schema";
import { createDenoWorker } from "@aai/core/deno-worker";
import { assertPublicUrl, getBuiltinToolSchemas } from "./builtin_tools.ts";
import type { KvStore } from "./kv.ts";
import type { AgentScope } from "./scope_token.ts";
export type { AgentMetadata } from "@aai/core/rpc-schema";

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

export type AgentSlot = {
  slug: string;
  env: Record<string, string>;
  transport: ("websocket" | "twilio")[];
  config?: AgentConfig;
  name?: string;
  toolSchemas?: ToolSchema[];
  ownerHash?: string;
  worker?: { handle: { terminate(): void }; api: WorkerApi };
  initializing?: Promise<void>;
  activeSessions: number;
  idleTimer?: ReturnType<typeof setTimeout>;
  _dev?: boolean;
};

async function spawnAgent(
  slot: AgentSlot,
  getWorkerCode?: (slug: string) => Promise<string | null>,
  kvCtx?: { kvStore: KvStore; scope: AgentScope },
): Promise<void> {
  const { slug } = slot;

  console.info("Spawning agent worker", { slug });

  if (!getWorkerCode) {
    throw new Error(`No worker code source for ${slug}`);
  }
  const code = await getWorkerCode(slug);
  if (!code) throw new Error(`Worker code not found for ${slug}`);
  const workerUrl = `data:application/javascript;base64,${encodeBase64(code)}`;

  const worker = createDenoWorker(workerUrl, slug, {
    net: false,
    read: false,
    env: false,
    run: false,
    write: false,
    ffi: false,
    sys: false,
  });

  worker.addEventListener(
    "error",
    ((event: ErrorEvent) => {
      console.error("Worker error", { slug, error: event.message });
      if (slot.worker?.handle === worker) slot.worker = undefined;
    }) as EventListener,
  );

  const api = createWorkerApi(worker, createHostApi(kvCtx));
  slot.worker = { handle: worker, api };
}

function createHostApi(
  kvCtx?: { kvStore: KvStore; scope: AgentScope },
): HostApi {
  return {
    async fetch(req) {
      await assertPublicUrl(req.url);
      const resp = await fetch(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.body,
        signal: AbortSignal.timeout(30_000),
      });
      const body = await resp.text();
      const headers: Record<string, string> = {};
      resp.headers.forEach((v, k) => {
        headers[k] = v;
      });
      return {
        status: resp.status,
        statusText: resp.statusText,
        headers,
        body,
      };
    },

    async kv(req): Promise<{ result: unknown }> {
      if (!kvCtx) throw new Error("KV not configured for this agent");
      const { kvStore, scope } = kvCtx;
      switch (req.op) {
        case "get":
          return { result: await kvStore.get(scope, req.key!) };
        case "set":
          await kvStore.set(scope, req.key!, req.value!, req.ttl);
          return { result: "OK" };
        case "del":
          await kvStore.del(scope, req.key!);
          return { result: "OK" };
        case "list":
          return {
            result: await kvStore.list(scope, req.prefix ?? "", {
              limit: req.limit,
              reverse: req.reverse,
            }),
          };
        default:
          throw new Error(`Unknown KV operation: ${req.op}`);
      }
    },
  };
}

export function ensureAgent(
  slot: AgentSlot,
  getWorkerCode?: (slug: string) => Promise<string | null>,
  kvCtx?: { kvStore: KvStore; scope: AgentScope },
): Promise<void> {
  const t0 = performance.now();

  if (slot.worker) {
    console.info("Agent ready", {
      slug: slot.slug,
      cached: true,
      durationMs: Math.round(performance.now() - t0),
    });
    return Promise.resolve();
  }
  if (slot.initializing) return slot.initializing;

  slot.initializing = spawnAgent(slot, getWorkerCode, kvCtx).then(() => {
    slot.initializing = undefined;
    console.info("Agent ready", {
      slug: slot.slug,
      name: slot.name,
      cached: false,
      durationMs: Math.round(performance.now() - t0),
    });
  }).catch((err) => {
    slot.initializing = undefined;
    throw err;
  });

  return slot.initializing;
}

export function trackSessionOpen(slot: AgentSlot): void {
  slot.activeSessions++;
  if (slot.idleTimer) {
    clearTimeout(slot.idleTimer);
    slot.idleTimer = undefined;
  }
}

export function trackSessionClose(
  slot: AgentSlot,
): void {
  slot.activeSessions = Math.max(0, slot.activeSessions - 1);
  if (slot.activeSessions === 0 && slot.worker) {
    const timerId = setTimeout(() => {
      if (slot.activeSessions === 0 && slot.worker) {
        console.info("Evicting idle agent Worker", { slug: slot.slug });
        slot.worker.handle.terminate();
        slot.worker = undefined;
        slot.idleTimer = undefined;
      }
    }, IDLE_TIMEOUT_MS);
    Deno.unrefTimer(timerId);
    slot.idleTimer = timerId;
  }
}

export function registerSlot(
  slots: Map<string, AgentSlot>,
  metadata: AgentMetadata,
): boolean {
  try {
    loadPlatformConfig(metadata.env); // validate only
  } catch (err: unknown) {
    console.warn("Skipping deploy — missing platform config", {
      slug: metadata.slug,
      err,
    });
    return false;
  }

  slots.set(metadata.slug, {
    slug: metadata.slug,
    env: metadata.env,
    transport: metadata.transport,
    config: metadata.config,
    name: metadata.config?.name,
    toolSchemas: metadata.toolSchemas,
    ownerHash: metadata.owner_hash,
    activeSessions: 0,
  });
  return true;
}

export function createToolExecutor(
  slot: AgentSlot,
  store: BundleStore,
  kvCtx?: { kvStore: KvStore; scope: AgentScope },
): { executeTool: ExecuteTool; getWorkerApi?: () => Promise<WorkerApi> } {
  const customTools = slot.toolSchemas ?? [];
  const getWorkerCode = (s: string) => store.getFile(s, "worker");
  if (customTools.length === 0) {
    return {
      executeTool: () => Promise.resolve("Error: No custom tools"),
    };
  }
  const getWorkerApi = async () => {
    await ensureAgent(slot, getWorkerCode, kvCtx);
    return slot.worker!.api;
  };
  return {
    executeTool: async (name, args, sessionId) => {
      const api = await getWorkerApi();
      return api.executeTool(name, args, sessionId, 30_000, slot.env);
    },
    getWorkerApi,
  };
}

export type SessionSetup = {
  agentConfig: AgentConfig;
  toolSchemas: ToolSchema[];
  platformConfig: ReturnType<typeof loadPlatformConfig>;
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
  const { executeTool, getWorkerApi } = createToolExecutor(slot, store, kvCtx);

  if ((slot.toolSchemas ?? []).length > 0 && !slot._dev) {
    const getWorkerCode = (s: string) => store.getFile(s, "worker");
    ensureAgent(slot, getWorkerCode, kvCtx).catch(() => {});
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

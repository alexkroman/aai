// Copyright 2025 the AAI authors. MIT license.
import type { BundleStore } from "./bundle_store_tigris.ts";
import { importScopeKey, type ScopeKey } from "./scope_token.ts";
import type { KvStore } from "./kv.ts";
import type { AgentMetadata, AgentSlot } from "./worker_pool.ts";
import type { AgentConfig } from "@aai/sdk/types";
import { AgentMetadataSchema } from "./_schemas.ts";
import { createOrchestrator } from "./orchestrator.ts";

export function flush(): Promise<void> {
  return new Promise<void>((r) => setTimeout(r, 0));
}

/** Poll `predicate` every tick until it returns true, or throw after `ms`. */
export async function waitFor(
  predicate: () => boolean,
  ms = 1000,
): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for condition");
    }
    await flush();
  }
}

export const DUMMY_INFO: Deno.ServeHandlerInfo = {
  remoteAddr: { transport: "tcp" as const, hostname: "127.0.0.1", port: 0 },
  completed: Promise.resolve(),
};

export const VALID_ENV = {
  ASSEMBLYAI_API_KEY: "test-key",
};

export function createTestStore(): BundleStore {
  const objects = new Map<string, string>();

  function objectKey(slug: string, file: string): string {
    return `agents/${slug}/${file}`;
  }

  function deleteByPrefix(prefix: string) {
    for (const key of objects.keys()) {
      if (key.startsWith(prefix)) objects.delete(key);
    }
  }

  return {
    putAgent(bundle) {
      deleteByPrefix(`agents/${bundle.slug}/`);
      const manifest = {
        slug: bundle.slug,
        env: bundle.env,
        transport: bundle.transport,
        "credential_hashes": bundle.credential_hashes,
      };
      objects.set(
        objectKey(bundle.slug, "manifest.json"),
        JSON.stringify(manifest),
      );
      objects.set(objectKey(bundle.slug, "worker.js"), bundle.worker);
      objects.set(objectKey(bundle.slug, "client.js"), bundle.client);
      objects.set(objectKey(bundle.slug, "index.html"), bundle.html);
      if (bundle.client_map) {
        objects.set(objectKey(bundle.slug, "client.js.map"), bundle.client_map);
      }
      return Promise.resolve();
    },

    getManifest(slug) {
      const data = objects.get(objectKey(slug, "manifest.json"));
      if (data === undefined) return Promise.resolve(null);
      const parsed = AgentMetadataSchema.safeParse(JSON.parse(data));
      if (!parsed.success) return Promise.resolve(null);
      return Promise.resolve(parsed.data as AgentMetadata);
    },

    getFile(slug, file) {
      const fileNames: Record<string, string> = {
        worker: "worker.js",
        client: "client.js",
        html: "index.html",
        "client_map": "client.js.map",
      };
      const fileName = fileNames[file];
      if (!fileName) return Promise.resolve(null);
      return Promise.resolve(
        objects.get(objectKey(slug, fileName)) ?? null,
      );
    },

    deleteAgent(slug) {
      deleteByPrefix(`agents/${slug}/`);
      return Promise.resolve();
    },

    getEnv(slug) {
      const data = objects.get(objectKey(slug, "manifest.json"));
      if (data === undefined) return Promise.resolve(null);
      const manifest = JSON.parse(data);
      return Promise.resolve(manifest.env ?? null);
    },

    putEnv(slug, env) {
      const data = objects.get(objectKey(slug, "manifest.json"));
      if (data === undefined) {
        return Promise.reject(new Error(`Agent ${slug} not found`));
      }
      const manifest = JSON.parse(data);
      manifest.env = env;
      objects.set(
        objectKey(slug, "manifest.json"),
        JSON.stringify(manifest),
      );
      return Promise.resolve();
    },

    close() {},
    [Symbol.dispose]() {},
  };
}

export function createTestScopeKey(): Promise<ScopeKey> {
  return importScopeKey("test-secret-for-tests-only");
}

/** Create a minimal AgentConfig for tests. */
export function makeConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    name: "Test",
    instructions: "Test",
    greeting: "Hi",
    voice: "luna",
    ...overrides,
  };
}

/** Create a minimal AgentSlot for tests. */
export function makeSlot(overrides?: Partial<AgentSlot>): AgentSlot {
  return {
    slug: "test-agent",
    env: VALID_ENV,
    transport: ["websocket"],
    keyHash: "test-key-hash",
    ...overrides,
  };
}

/** Build a deploy request body. */
export function deployBody(
  overrides?: Record<string, unknown>,
): string {
  return JSON.stringify({
    env: VALID_ENV,
    worker: "console.log('w');",
    client: "console.log('c');",
    html:
      '<!DOCTYPE html><html><body><script src="client.js"></script></body></html>',
    ...overrides,
  });
}

/** Create a fully wired test orchestrator. */
export async function createTestOrchestrator(): Promise<{
  handler: Deno.ServeHandler;
  store: BundleStore;
  scopeKey: ScopeKey;
  kvStore: KvStore;
}> {
  const store = createTestStore();
  const scopeKey = await createTestScopeKey();
  const kvStore = createTestKvStore();
  const handler = createOrchestrator({ store, scopeKey, kvStore });
  return { handler, store, scopeKey, kvStore };
}

export function createTestKvStore(): KvStore {
  const store = new Map<string, string>();

  function scopedKey(
    scope: { keyHash: string; slug: string },
    key: string,
  ): string {
    return `kv:${scope.keyHash}:${scope.slug}:${key}`;
  }

  function scopePrefix(scope: {
    keyHash: string;
    slug: string;
  }): string {
    return `kv:${scope.keyHash}:${scope.slug}:`;
  }

  return {
    get(scope, key) {
      return Promise.resolve(store.get(scopedKey(scope, key)) ?? null);
    },
    set(scope, key, value) {
      store.set(scopedKey(scope, key), value);
      return Promise.resolve();
    },
    del(scope, key) {
      store.delete(scopedKey(scope, key));
      return Promise.resolve();
    },
    keys(scope, pattern) {
      const prefix = scopePrefix(scope);
      const results: string[] = [];
      for (const key of store.keys()) {
        if (key.startsWith(prefix)) {
          results.push(key.slice(prefix.length));
        }
      }
      if (pattern) {
        const regex = new RegExp(
          "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
        );
        return Promise.resolve(results.filter((k) => regex.test(k)));
      }
      return Promise.resolve(results);
    },
    list(scope, userPrefix, options) {
      const prefix = scopePrefix(scope);
      const fullPrefix = `${prefix}${userPrefix}`;
      const entries: { key: string; value: unknown }[] = [];
      for (const [key, value] of store) {
        if (key.startsWith(fullPrefix)) {
          const userKey = key.slice(prefix.length);
          try {
            entries.push({ key: userKey, value: JSON.parse(value) });
          } catch {
            entries.push({ key: userKey, value });
          }
        }
      }
      entries.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
      if (options?.reverse) entries.reverse();
      if (options?.limit && options.limit > 0) {
        entries.length = Math.min(entries.length, options.limit);
      }
      return Promise.resolve(entries);
    },
  };
}

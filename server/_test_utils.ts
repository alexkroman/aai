import {
  type BundleStore,
  createBundleStore,
  createMemoryS3Client,
} from "./bundle_store_tigris.ts";
import { importScopeKey, type ScopeKey } from "./scope_token.ts";
import { createMemoryKvStore, type KvStore } from "./kv.ts";

export const flush = (): Promise<void> =>
  new Promise<void>((r) => setTimeout(r, 0));

/** Poll `predicate` every tick until it returns true, or throw after `ms`. */
export async function waitFor(
  predicate: () => boolean,
  ms = 1000,
): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
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
  return createBundleStore(createMemoryS3Client(), "test-bucket");
}

export function createTestScopeKey(): Promise<ScopeKey> {
  return importScopeKey("test-secret-for-tests-only");
}

export function createTestKvStore(): KvStore {
  return createMemoryKvStore();
}

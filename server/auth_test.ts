// Copyright 2025 the AAI authors. MIT license.
import {
  assert,
  assertEquals,
  assertMatch,
  assertNotStrictEquals,
  assertStrictEquals,
} from "@std/assert";
import {
  claimNamespace,
  hashApiKey,
  verifyOrClaimNamespace,
  verifyOwner,
} from "./auth.ts";
import { createTestStore } from "./_test_utils.ts";

Deno.test("hashApiKey produces consistent 64-char hex", async () => {
  const h1 = await hashApiKey("key");
  const h2 = await hashApiKey("key");
  assertStrictEquals(h1, h2);
  assertMatch(h1, /^[0-9a-f]{64}$/);
  assertNotStrictEquals(await hashApiKey("other"), h1);
});

Deno.test("verifyOwner returns hash for unclaimed namespace", async () => {
  const store = createTestStore();
  const result = await verifyOwner("key1", { namespace: "ns", store });
  assert(result !== null);
  assertStrictEquals(result, await hashApiKey("key1"));
  // Does not claim
  assertStrictEquals(await store.getNamespaceOwner("ns"), null);
});

Deno.test("verifyOwner allows same key for claimed namespace", async () => {
  const store = createTestStore();
  const hash = await hashApiKey("key1");
  await store.putNamespaceOwner("ns", {
    "account_id": "acct-1",
    "credential_hashes": [hash],
  });
  const result = await verifyOwner("key1", { namespace: "ns", store });
  assertStrictEquals(result, "acct-1");
});

Deno.test("verifyOwner rejects different key", async () => {
  const store = createTestStore();
  await store.putNamespaceOwner("ns", {
    "account_id": "acct-1",
    "credential_hashes": [await hashApiKey("key1")],
  });
  const result = await verifyOwner("key2", { namespace: "ns", store });
  assertStrictEquals(result, null);
});

Deno.test("claimNamespace persists ownership", async () => {
  const store = createTestStore();
  const hash = await hashApiKey("key1");
  const owner = { "account_id": "acct-1", "credential_hashes": [hash] };
  await claimNamespace("ns", { owner, store });
  assertEquals(await store.getNamespaceOwner("ns"), owner);
});

Deno.test("verifyOrClaimNamespace creates account for unclaimed namespace", async () => {
  const store = createTestStore();
  const accountId = await verifyOrClaimNamespace("key1", {
    namespace: "ns",
    store,
  });
  assert(accountId);
  // Namespace is now claimed
  const owner = await store.getNamespaceOwner("ns");
  assert(owner !== null);
  assertStrictEquals(owner!.account_id, accountId);
  assert(owner!.credential_hashes.includes(await hashApiKey("key1")));
});

Deno.test("verifyOrClaimNamespace returns accountId for existing owner", async () => {
  const store = createTestStore();
  const hash = await hashApiKey("key1");
  await store.putNamespaceOwner("ns", {
    account_id: "acct-1",
    credential_hashes: [hash],
  });
  const accountId = await verifyOrClaimNamespace("key1", {
    namespace: "ns",
    store,
  });
  assertStrictEquals(accountId, "acct-1");
});

Deno.test("verifyOwner allows multiple credential hashes", async () => {
  const store = createTestStore();
  const hash1 = await hashApiKey("key1");
  const hash2 = await hashApiKey("key2");
  await store.putNamespaceOwner("ns", {
    account_id: "acct-1",
    credential_hashes: [hash1, hash2],
  });
  assertStrictEquals(
    await verifyOwner("key1", { namespace: "ns", store }),
    "acct-1",
  );
  assertStrictEquals(
    await verifyOwner("key2", { namespace: "ns", store }),
    "acct-1",
  );
  assertStrictEquals(
    await verifyOwner("key3", { namespace: "ns", store }),
    null,
  );
});

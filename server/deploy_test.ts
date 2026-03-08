import { expect } from "@std/expect";
import { handleDeploy, hashApiKey } from "./deploy.ts";
import type { AgentSlot } from "./worker_pool.ts";
import { createTestStore, VALID_ENV } from "./_test_utils.ts";

function setup() {
  return { store: createTestStore(), slots: new Map<string, AgentSlot>() };
}

function deployRequest(apiKey?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  return new Request("http://localhost/ns/my-agent/deploy", {
    method: "POST",
    headers,
    body: JSON.stringify({
      env: VALID_ENV,
      worker: "console.log('w');",
      client: "console.log('c');",
    }),
  });
}

Deno.test("deploy rejects missing Authorization header", async () => {
  const { store, slots } = setup();
  const res = await handleDeploy(deployRequest(), "ns", "my-agent", {
    slots,
    store,
  });
  expect(res.status).toBe(400);
});

Deno.test("new deploy succeeds and stores owner_hash", async () => {
  const { store, slots } = setup();
  const res = await handleDeploy(deployRequest("key1"), "ns", "my-agent", {
    slots,
    store,
  });
  expect(res.status).toBe(200);
  const manifest = await store.getManifest("ns/my-agent");
  expect(manifest!.owner_hash).toBe(await hashApiKey("key1"));
});

Deno.test("same key can redeploy", async () => {
  const { store, slots } = setup();
  await handleDeploy(deployRequest("key1"), "ns", "my-agent", {
    slots,
    store,
  });
  const res = await handleDeploy(deployRequest("key1"), "ns", "my-agent", {
    slots,
    store,
  });
  expect(res.status).toBe(200);
});

Deno.test("different key is rejected for namespace owned by another", async () => {
  const { store, slots } = setup();
  await handleDeploy(deployRequest("key1"), "ns", "my-agent", {
    slots,
    store,
  });
  const res = await handleDeploy(deployRequest("key2"), "ns", "other-agent", {
    slots,
    store,
  });
  expect(res.status).toBe(403);
});

Deno.test("different namespaces with different keys both succeed", async () => {
  const { store, slots } = setup();
  const res1 = await handleDeploy(deployRequest("key1"), "ns-a", "agent", {
    slots,
    store,
  });
  const res2 = await handleDeploy(deployRequest("key2"), "ns-b", "agent", {
    slots,
    store,
  });
  expect(res1.status).toBe(200);
  expect(res2.status).toBe(200);
});

Deno.test("hashApiKey produces consistent hex output", async () => {
  const hash1 = await hashApiKey("test-key");
  const hash2 = await hashApiKey("test-key");
  expect(hash1).toBe(hash2);
  expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  expect(await hashApiKey("other-key")).not.toBe(hash1);
});

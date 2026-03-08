import { Hono } from "hono";
import { expect } from "@std/expect";
import { handleDeploy, hashApiKey } from "./deploy.ts";
import type { AgentSlot } from "./worker_pool.ts";
import { createTestStore, VALID_ENV } from "./_test_utils.ts";

function setup() {
  const store = createTestStore();
  const slots = new Map<string, AgentSlot>();
  const app = new Hono();
  app.post(
    "/:namespace/:slug/deploy",
    (c) => handleDeploy(c, { slots, store }),
  );
  return { store, slots, app };
}

function deployInit(apiKey?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  return {
    method: "POST" as const,
    headers,
    body: JSON.stringify({
      env: VALID_ENV,
      worker: "console.log('w');",
      client: "console.log('c');",
    }),
  };
}

Deno.test("deploy rejects missing Authorization header", async () => {
  const { app } = setup();
  const res = await app.request("/ns/my-agent/deploy", deployInit());
  expect(res.status).toBe(400);
});

Deno.test("new deploy succeeds and stores owner_hash", async () => {
  const { app, store } = setup();
  const res = await app.request("/ns/my-agent/deploy", deployInit("key1"));
  expect(res.status).toBe(200);
  const manifest = await store.getManifest("ns/my-agent");
  expect(manifest!.owner_hash).toBe(await hashApiKey("key1"));
});

Deno.test("same key can redeploy", async () => {
  const { app } = setup();
  await app.request("/ns/my-agent/deploy", deployInit("key1"));
  const res = await app.request("/ns/my-agent/deploy", deployInit("key1"));
  expect(res.status).toBe(200);
});

Deno.test("different key is rejected for namespace owned by another", async () => {
  const { app } = setup();
  await app.request("/ns/my-agent/deploy", deployInit("key1"));
  const res = await app.request(
    "/ns/other-agent/deploy",
    deployInit("key2"),
  );
  expect(res.status).toBe(403);
});

Deno.test("different namespaces with different keys both succeed", async () => {
  const { app } = setup();
  const res1 = await app.request("/ns-a/agent/deploy", deployInit("key1"));
  const res2 = await app.request("/ns-b/agent/deploy", deployInit("key2"));
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

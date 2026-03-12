// Copyright 2025 the AAI authors. MIT license.
import { assertNotStrictEquals, assertStrictEquals } from "@std/assert";
import { discoverSlot, resolveSlot } from "./transport_websocket.ts";
import type { AgentSlot } from "./worker_pool.ts";
import { createTestStore, makeSlot, VALID_ENV } from "./_test_utils.ts";

// --- discoverSlot ---

Deno.test("discoverSlot returns existing slot from map", async () => {
  const slot = makeSlot();
  const slots = new Map([["ns/test-agent", slot]]);
  const store = createTestStore();
  const result = await discoverSlot("ns/test-agent", slots, store);
  assertStrictEquals(result, slot);
});

Deno.test("discoverSlot returns null when not in map and not in store", async () => {
  const store = createTestStore();
  const result = await discoverSlot("ns/missing", new Map(), store);
  assertStrictEquals(result, null);
});

Deno.test("discoverSlot lazy-loads from store", async () => {
  const store = createTestStore();
  const slots = new Map<string, AgentSlot>();
  await store.putAgent({
    slug: "ns/stored-agent",
    env: VALID_ENV,
    transport: ["websocket"],
    worker: "console.log('w');",
    client: "console.log('c');",
  });
  const result = await discoverSlot("ns/stored-agent", slots, store);
  assertNotStrictEquals(result, null);
  assertStrictEquals(result!.slug, "ns/stored-agent");
  assertStrictEquals(slots.has("ns/stored-agent"), true);
});

// --- resolveSlot ---

Deno.test("resolveSlot returns null for twilio-only slot", async () => {
  const slot = makeSlot({ transport: ["twilio"] });
  const store = createTestStore();
  const result = await resolveSlot(
    "ns/twilio-only",
    new Map([["ns/twilio-only", slot]]),
    store,
  );
  assertStrictEquals(result, null);
});

Deno.test("resolveSlot returns slot with websocket transport", async () => {
  const slot = makeSlot({ transport: ["websocket", "twilio"] });
  const store = createTestStore();
  const result = await resolveSlot(
    "ns/both",
    new Map([["ns/both", slot]]),
    store,
  );
  assertStrictEquals(result, slot);
});

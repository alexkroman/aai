import { expect } from "@std/expect";
import { type AgentSlot, registerSlot } from "./worker_pool.ts";
import { VALID_ENV } from "./_test_utils.ts";

// --- registerSlot ---

Deno.test("registerSlot with valid env", () => {
  const slots = new Map<string, AgentSlot>();
  const ok = registerSlot(slots, {
    slug: "hello",
    env: VALID_ENV,
    transport: ["websocket"],
    owner_hash: "test-owner",
  });
  expect(ok).toBe(true);
  expect(slots.has("hello")).toBe(true);
});

Deno.test("registerSlot returns false for invalid env", () => {
  const slots = new Map<string, AgentSlot>();
  const ok = registerSlot(slots, {
    slug: "bad",
    env: {},
    transport: ["websocket"],
    owner_hash: "test-owner",
  });
  expect(ok).toBe(false);
  expect(slots.has("bad")).toBe(false);
});

Deno.test("registerSlot overwrites existing slot", () => {
  const slots = new Map<string, AgentSlot>();
  registerSlot(slots, {
    slug: "x",
    env: VALID_ENV,
    transport: ["websocket"],
    owner_hash: "test-owner",
  });
  registerSlot(slots, {
    slug: "x",
    env: VALID_ENV,
    transport: ["websocket"],
    owner_hash: "test-owner",
  });
  expect(slots.size).toBe(1);
});

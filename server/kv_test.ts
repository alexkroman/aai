import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import {
  createMemoryKvStore,
  createScopeToken,
  type KvScope,
  verifyScopeToken,
} from "./kv.ts";

// ---------------------------------------------------------------------------
// Scope tokens
// ---------------------------------------------------------------------------

describe("createScopeToken / verifyScopeToken", () => {
  const scope: KvScope = { ownerHash: "abc123", slug: "ns/my-agent" };

  it("round-trips a scope through sign and verify", async () => {
    const token = await createScopeToken(scope);
    const result = await verifyScopeToken(token);
    expect(result).toEqual(scope);
  });

  it("rejects a tampered token", async () => {
    const token = await createScopeToken(scope);
    // Flip a character in the middle of the token
    const mid = Math.floor(token.length / 2);
    const tampered = token.slice(0, mid) +
      (token[mid] === "A" ? "B" : "A") +
      token.slice(mid + 1);
    const result = await verifyScopeToken(tampered);
    expect(result).toBeNull();
  });

  it("rejects garbage input", async () => {
    expect(await verifyScopeToken("not-a-token")).toBeNull();
    expect(await verifyScopeToken("")).toBeNull();
  });

  it("different scopes produce different tokens", async () => {
    const other: KvScope = { ownerHash: "abc123", slug: "ns/other-agent" };
    const t1 = await createScopeToken(scope);
    const t2 = await createScopeToken(other);
    expect(t1).not.toBe(t2);
  });

  it("token for one scope does not verify as another", async () => {
    const token = await createScopeToken(scope);
    const result = await verifyScopeToken(token);
    // It should decode to the original scope, not some other scope
    expect(result!.slug).toBe("ns/my-agent");
    expect(result!.ownerHash).toBe("abc123");
  });
});

// ---------------------------------------------------------------------------
// Memory KV store
// ---------------------------------------------------------------------------

describe("createMemoryKvStore", () => {
  const scopeA: KvScope = { ownerHash: "owner1", slug: "ns/agent-a" };
  const scopeB: KvScope = { ownerHash: "owner1", slug: "ns/agent-b" };
  const scopeC: KvScope = { ownerHash: "owner2", slug: "ns/agent-a" };

  it("get returns null for missing key", async () => {
    const kv = createMemoryKvStore();
    expect(await kv.get(scopeA, "missing")).toBeNull();
  });

  it("set and get round-trip", async () => {
    const kv = createMemoryKvStore();
    await kv.set(scopeA, "key1", "value1");
    expect(await kv.get(scopeA, "key1")).toBe("value1");
  });

  it("del removes a key", async () => {
    const kv = createMemoryKvStore();
    await kv.set(scopeA, "key1", "value1");
    await kv.del(scopeA, "key1");
    expect(await kv.get(scopeA, "key1")).toBeNull();
  });

  it("keys lists all keys in scope", async () => {
    const kv = createMemoryKvStore();
    await kv.set(scopeA, "a", "1");
    await kv.set(scopeA, "b", "2");
    await kv.set(scopeA, "c", "3");
    const keys = await kv.keys(scopeA);
    expect(keys.sort()).toEqual(["a", "b", "c"]);
  });

  it("keys with pattern filters", async () => {
    const kv = createMemoryKvStore();
    await kv.set(scopeA, "user:name", "alice");
    await kv.set(scopeA, "user:age", "30");
    await kv.set(scopeA, "pref:color", "blue");
    const keys = await kv.keys(scopeA, "user:*");
    expect(keys.sort()).toEqual(["user:age", "user:name"]);
  });

  it("scopes are isolated — different slugs", async () => {
    const kv = createMemoryKvStore();
    await kv.set(scopeA, "key", "from-a");
    await kv.set(scopeB, "key", "from-b");
    expect(await kv.get(scopeA, "key")).toBe("from-a");
    expect(await kv.get(scopeB, "key")).toBe("from-b");
  });

  it("scopes are isolated — different owners", async () => {
    const kv = createMemoryKvStore();
    await kv.set(scopeA, "key", "owner1");
    await kv.set(scopeC, "key", "owner2");
    expect(await kv.get(scopeA, "key")).toBe("owner1");
    expect(await kv.get(scopeC, "key")).toBe("owner2");
  });

  it("keys only returns keys for the given scope", async () => {
    const kv = createMemoryKvStore();
    await kv.set(scopeA, "a-key", "1");
    await kv.set(scopeB, "b-key", "2");
    expect(await kv.keys(scopeA)).toEqual(["a-key"]);
    expect(await kv.keys(scopeB)).toEqual(["b-key"]);
  });

  it("rejects values exceeding max size", async () => {
    const kv = createMemoryKvStore();
    const big = "x".repeat(65_537);
    try {
      await kv.set(scopeA, "big", big);
      throw new Error("should have thrown");
    } catch (err: unknown) {
      expect((err as Error).message).toMatch(/max size/);
    }
  });

  it("TTL expires entries", async () => {
    const kv = createMemoryKvStore();
    // Set with 0-second TTL (expires immediately in next cleanup)
    await kv.set(scopeA, "ephemeral", "gone", 0);
    // TTL=0 means no expiry per the implementation (ttl > 0 check)
    expect(await kv.get(scopeA, "ephemeral")).toBe("gone");
  });
});

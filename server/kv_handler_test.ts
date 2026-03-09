import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { handleKv } from "./kv_handler.ts";
import { createMemoryKvStore, createScopeToken, type KvScope } from "./kv.ts";

const scope: KvScope = { ownerHash: "owner1", slug: "ns/agent-a" };

function kvReq(
  token: string,
  body: Record<string, unknown>,
): Request {
  return new Request("http://localhost/kv", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

describe("handleKv", () => {
  it("rejects missing Authorization header", async () => {
    const kvStore = createMemoryKvStore();
    const req = new Request("http://localhost/kv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "get", key: "k" }),
    });
    const res = await handleKv(req, { kvStore });
    expect(res.status).toBe(401);
  });

  it("rejects invalid scope token", async () => {
    const kvStore = createMemoryKvStore();
    const req = kvReq("bad-token", { op: "get", key: "k" });
    const res = await handleKv(req, { kvStore });
    expect(res.status).toBe(403);
  });

  it("rejects invalid JSON body", async () => {
    const kvStore = createMemoryKvStore();
    const token = await createScopeToken(scope);
    const req = new Request("http://localhost/kv", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: "not json",
    });
    const res = await handleKv(req, { kvStore });
    expect(res.status).toBe(400);
  });

  it("rejects invalid op", async () => {
    const kvStore = createMemoryKvStore();
    const token = await createScopeToken(scope);
    const req = kvReq(token, { op: "drop_table" });
    const res = await handleKv(req, { kvStore });
    expect(res.status).toBe(400);
  });

  it("set and get round-trip", async () => {
    const kvStore = createMemoryKvStore();
    const token = await createScopeToken(scope);

    const setRes = await handleKv(
      kvReq(token, { op: "set", key: "k1", value: "v1" }),
      { kvStore },
    );
    expect(setRes.status).toBe(200);
    expect((await setRes.json()).result).toBe("OK");

    const getRes = await handleKv(
      kvReq(token, { op: "get", key: "k1" }),
      { kvStore },
    );
    expect(getRes.status).toBe(200);
    expect((await getRes.json()).result).toBe("v1");
  });

  it("get returns null for missing key", async () => {
    const kvStore = createMemoryKvStore();
    const token = await createScopeToken(scope);
    const res = await handleKv(
      kvReq(token, { op: "get", key: "nope" }),
      { kvStore },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).result).toBeNull();
  });

  it("del removes a key", async () => {
    const kvStore = createMemoryKvStore();
    const token = await createScopeToken(scope);

    await handleKv(
      kvReq(token, { op: "set", key: "k1", value: "v1" }),
      { kvStore },
    );
    await handleKv(
      kvReq(token, { op: "del", key: "k1" }),
      { kvStore },
    );

    const res = await handleKv(
      kvReq(token, { op: "get", key: "k1" }),
      { kvStore },
    );
    expect((await res.json()).result).toBeNull();
  });

  it("keys lists stored keys", async () => {
    const kvStore = createMemoryKvStore();
    const token = await createScopeToken(scope);

    await handleKv(
      kvReq(token, { op: "set", key: "a", value: "1" }),
      { kvStore },
    );
    await handleKv(
      kvReq(token, { op: "set", key: "b", value: "2" }),
      { kvStore },
    );

    const res = await handleKv(
      kvReq(token, { op: "keys" }),
      { kvStore },
    );
    const body = await res.json();
    expect(body.result.sort()).toEqual(["a", "b"]);
  });

  it("different scope tokens are isolated", async () => {
    const kvStore = createMemoryKvStore();
    const scopeOther: KvScope = {
      ownerHash: "owner1",
      slug: "ns/agent-b",
    };
    const tokenA = await createScopeToken(scope);
    const tokenB = await createScopeToken(scopeOther);

    await handleKv(
      kvReq(tokenA, { op: "set", key: "secret", value: "agent-a-data" }),
      { kvStore },
    );

    // Agent B cannot read agent A's data
    const res = await handleKv(
      kvReq(tokenB, { op: "get", key: "secret" }),
      { kvStore },
    );
    expect((await res.json()).result).toBeNull();

    // Agent B's keys list is empty
    const keysRes = await handleKv(
      kvReq(tokenB, { op: "keys" }),
      { kvStore },
    );
    expect((await keysRes.json()).result).toEqual([]);
  });

  it("set requires key", async () => {
    const kvStore = createMemoryKvStore();
    const token = await createScopeToken(scope);
    const res = await handleKv(
      kvReq(token, { op: "set", value: "v" }),
      { kvStore },
    );
    expect(res.status).toBe(400);
  });

  it("set requires value", async () => {
    const kvStore = createMemoryKvStore();
    const token = await createScopeToken(scope);
    const res = await handleKv(
      kvReq(token, { op: "set", key: "k" }),
      { kvStore },
    );
    expect(res.status).toBe(400);
  });

  it("get requires key", async () => {
    const kvStore = createMemoryKvStore();
    const token = await createScopeToken(scope);
    const res = await handleKv(
      kvReq(token, { op: "get" }),
      { kvStore },
    );
    expect(res.status).toBe(400);
  });

  it("del requires key", async () => {
    const kvStore = createMemoryKvStore();
    const token = await createScopeToken(scope);
    const res = await handleKv(
      kvReq(token, { op: "del" }),
      { kvStore },
    );
    expect(res.status).toBe(400);
  });
});

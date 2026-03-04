import { expect } from "@std/expect";
import { MemoryBundleStore } from "./bundle_store_memory.ts";
import { VALID_ENV } from "./_test_utils.ts";

Deno.test("MemoryBundleStore", async (t) => {
  await t.step("put + get round-trip", async () => {
    const store = new MemoryBundleStore();
    await store.putAgent({
      slug: "hello",
      env: VALID_ENV,
      transport: ["websocket"],
      worker: "console.log('worker');",
      client: "console.log('client');",
    });

    const manifest = await store.getManifest("hello");
    expect(manifest).toEqual({
      slug: "hello",
      env: VALID_ENV,
      transport: ["websocket"],
    });

    const worker = await store.getFile("hello", "worker");
    expect(worker).toBe("console.log('worker');");

    const client = await store.getFile("hello", "client");
    expect(client).toBe("console.log('client');");
  });

  await t.step("deleteAgent removes all data", async () => {
    const store = new MemoryBundleStore();
    await store.putAgent({
      slug: "gone",
      env: VALID_ENV,
      transport: ["websocket"],
      worker: "w",
      client: "c",
    });
    await store.deleteAgent("gone");

    expect(await store.getManifest("gone")).toBeNull();
    expect(await store.getFile("gone", "worker")).toBeNull();
    expect(await store.getFile("gone", "client")).toBeNull();
  });

  await t.step("overwrite replaces existing agent", async () => {
    const store = new MemoryBundleStore();
    await store.putAgent({
      slug: "x",
      env: VALID_ENV,
      transport: ["websocket"],
      worker: "old",
      client: "old",
    });
    await store.putAgent({
      slug: "x",
      env: { ...VALID_ENV, EXTRA: "val" },
      transport: ["websocket"],
      worker: "new",
      client: "new",
    });

    const manifest = await store.getManifest("x");
    expect(manifest!.env.EXTRA).toBe("val");
    expect(await store.getFile("x", "worker")).toBe("new");
  });

  await t.step("handles large strings", async () => {
    const store = new MemoryBundleStore();
    const big = "x".repeat(150_000);
    await store.putAgent({
      slug: "big",
      env: VALID_ENV,
      transport: ["websocket"],
      worker: big,
      client: "small",
    });

    const result = await store.getFile("big", "worker");
    expect(result).toBe(big);
    expect(result!.length).toBe(150_000);
  });

  await t.step("missing slug returns null", async () => {
    const store = new MemoryBundleStore();
    expect(await store.getManifest("nope")).toBeNull();
    expect(await store.getFile("nope", "worker")).toBeNull();
    expect(await store.getFile("nope", "client")).toBeNull();
  });

  await t.step("clientMap is optional", async () => {
    const store = new MemoryBundleStore();
    await store.putAgent({
      slug: "nomap",
      env: VALID_ENV,
      transport: ["websocket"],
      worker: "w",
      client: "c",
    });
    expect(await store.getFile("nomap", "client_map")).toBeNull();
  });

  await t.step("stores and retrieves clientMap when provided", async () => {
    const store = new MemoryBundleStore();
    await store.putAgent({
      slug: "mapped",
      env: VALID_ENV,
      transport: ["websocket"],
      worker: "w",
      client: "c",
      client_map: '{"mappings":[]}',
    });
    expect(await store.getFile("mapped", "client_map")).toBe(
      '{"mappings":[]}',
    );
  });

  await t.step("multiple agents are independent", async () => {
    const store = new MemoryBundleStore();
    await store.putAgent({
      slug: "a",
      env: VALID_ENV,
      transport: ["websocket"],
      worker: "wa",
      client: "ca",
    });
    await store.putAgent({
      slug: "b",
      env: VALID_ENV,
      transport: ["websocket"],
      worker: "wb",
      client: "cb",
    });

    await store.deleteAgent("a");

    expect(await store.getManifest("a")).toBeNull();
    expect(await store.getFile("b", "worker")).toBe("wb");
  });

  await t.step("close is a no-op", () => {
    const store = new MemoryBundleStore();
    store.close();
  });
});

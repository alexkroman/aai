import { assertEquals, assertThrows } from "@std/assert";
import { createMemoryKv } from "./kv.ts";
import { FakeTime } from "@std/testing/time";

Deno.test("createMemoryKv", async (t) => {
  await t.step("get returns null for missing key", async () => {
    const kv = createMemoryKv();
    assertEquals(await kv.get("nope"), null);
  });

  await t.step("set then get with auto-serialization", async () => {
    const kv = createMemoryKv();
    await kv.set("k1", { name: "alice", age: 30 });
    assertEquals(await kv.get("k1"), { name: "alice", age: 30 });
  });

  await t.step("set then get with string value", async () => {
    const kv = createMemoryKv();
    await kv.set("k1", "hello");
    assertEquals(await kv.get("k1"), "hello");
  });

  await t.step("set then get with number value", async () => {
    const kv = createMemoryKv();
    await kv.set("k1", 42);
    assertEquals(await kv.get("k1"), 42);
  });

  await t.step("delete removes key", async () => {
    const kv = createMemoryKv();
    await kv.set("k1", "v1");
    await kv.delete("k1");
    assertEquals(await kv.get("k1"), null);
  });

  await t.step("list returns entries matching prefix", async () => {
    const kv = createMemoryKv();
    await kv.set("user:1", { name: "alice" });
    await kv.set("user:2", { name: "bob" });
    await kv.set("post:1", { title: "hello" });
    const entries = await kv.list("user:");
    assertEquals(entries.length, 2);
    assertEquals(entries[0], { key: "user:1", value: { name: "alice" } });
    assertEquals(entries[1], { key: "user:2", value: { name: "bob" } });
  });

  await t.step("list returns entries sorted by key", async () => {
    const kv = createMemoryKv();
    await kv.set("c", 3);
    await kv.set("a", 1);
    await kv.set("b", 2);
    const entries = await kv.list("");
    assertEquals(entries.map((e) => e.key), ["a", "b", "c"]);
  });

  await t.step("list with reverse", async () => {
    const kv = createMemoryKv();
    await kv.set("a", 1);
    await kv.set("b", 2);
    await kv.set("c", 3);
    const entries = await kv.list("", { reverse: true });
    assertEquals(entries.map((e) => e.key), ["c", "b", "a"]);
  });

  await t.step("list with limit", async () => {
    const kv = createMemoryKv();
    await kv.set("a", 1);
    await kv.set("b", 2);
    await kv.set("c", 3);
    const entries = await kv.list("", { limit: 2 });
    assertEquals(entries.length, 2);
    assertEquals(entries.map((e) => e.key), ["a", "b"]);
  });

  await t.step("list with reverse and limit", async () => {
    const kv = createMemoryKv();
    await kv.set("a", 1);
    await kv.set("b", 2);
    await kv.set("c", 3);
    const entries = await kv.list("", { limit: 2, reverse: true });
    assertEquals(entries.map((e) => e.key), ["c", "b"]);
  });

  await t.step("rejects oversized values", () => {
    const kv = createMemoryKv();
    const big = "x".repeat(65_537);
    assertThrows(
      () => kv.set("big", big),
      Error,
      "exceeds max size",
    );
  });

  await t.step("expireIn expires entries", async () => {
    using time = new FakeTime();
    const kv = createMemoryKv();
    await kv.set("temp", "val", { expireIn: 10_000 });
    assertEquals(await kv.get("temp"), "val");

    time.tick(11_000);
    assertEquals(await kv.get("temp"), null);
  });

  await t.step("expired entries excluded from list", async () => {
    using time = new FakeTime();
    const kv = createMemoryKv();
    await kv.set("alive", "1");
    await kv.set("dying", "2", { expireIn: 5_000 });

    time.tick(6_000);
    const entries = await kv.list("");
    assertEquals(entries.length, 1);
    assertEquals(entries[0].key, "alive");
  });

  await t.step("overwrite replaces value", async () => {
    const kv = createMemoryKv();
    await kv.set("k", "v1");
    await kv.set("k", "v2");
    assertEquals(await kv.get("k"), "v2");
  });

  await t.step(
    "separate createMemoryKv calls have isolated stores",
    async () => {
      const kv1 = createMemoryKv();
      const kv2 = createMemoryKv();
      await kv1.set("x", "from1");
      assertEquals(await kv2.get("x"), null);
    },
  );

  await t.step("get with generic type", async () => {
    const kv = createMemoryKv();
    await kv.set("user", { name: "alice", age: 30 });
    const user = await kv.get<{ name: string; age: number }>("user");
    assertEquals(user?.name, "alice");
    assertEquals(user?.age, 30);
  });

  await t.step("list with generic type", async () => {
    const kv = createMemoryKv();
    await kv.set("item:1", { title: "first" });
    await kv.set("item:2", { title: "second" });
    const entries = await kv.list<{ title: string }>("item:");
    assertEquals(entries[0].value.title, "first");
    assertEquals(entries[1].value.title, "second");
  });
});

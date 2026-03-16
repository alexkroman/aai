// Copyright 2025 the AAI authors. MIT license.
import { assertEquals } from "@std/assert";
import { createMemoryVectorStore } from "./vector.ts";

Deno.test("createMemoryVectorStore", async (t) => {
  await t.step("query returns empty for empty store", async () => {
    const v = createMemoryVectorStore();
    assertEquals(await v.query("anything"), []);
  });

  await t.step("upsert and query returns matching entries", async () => {
    const v = createMemoryVectorStore();
    await v.upsert("doc-1", "The capital of France is Paris.");
    await v.upsert("doc-2", "The capital of Germany is Berlin.");
    const results = await v.query("France capital");
    assertEquals(results.length, 2);
    assertEquals(results[0]!.id, "doc-1");
    assertEquals(results[0]!.score, 1); // both words match
  });

  await t.step("query scores by word match ratio", async () => {
    const v = createMemoryVectorStore();
    await v.upsert("a", "apple banana cherry");
    await v.upsert("b", "apple cherry");
    const results = await v.query("apple banana cherry");
    assertEquals(results[0]!.id, "a"); // 3/3 matches
    assertEquals(results[0]!.score, 1);
    assertEquals(results[1]!.id, "b"); // 2/3 matches
  });

  await t.step("query respects topK", async () => {
    const v = createMemoryVectorStore();
    await v.upsert("a", "word");
    await v.upsert("b", "word");
    await v.upsert("c", "word");
    const results = await v.query("word", { topK: 2 });
    assertEquals(results.length, 2);
  });

  await t.step("query is case insensitive", async () => {
    const v = createMemoryVectorStore();
    await v.upsert("doc", "Hello World");
    const results = await v.query("hello");
    assertEquals(results.length, 1);
    assertEquals(results[0]!.id, "doc");
  });

  await t.step("upsert preserves metadata", async () => {
    const v = createMemoryVectorStore();
    await v.upsert("doc", "some text", { source: "test" });
    const results = await v.query("some text");
    assertEquals(results[0]!.metadata, { source: "test" });
  });

  await t.step("upsert overwrites existing entry", async () => {
    const v = createMemoryVectorStore();
    await v.upsert("doc", "old text");
    await v.upsert("doc", "new text");
    assertEquals(await v.query("old"), []);
    const results = await v.query("new text");
    assertEquals(results.length, 1);
    assertEquals(results[0]!.data, "new text");
  });

  await t.step("remove deletes single entry", async () => {
    const v = createMemoryVectorStore();
    await v.upsert("doc", "hello");
    await v.remove("doc");
    assertEquals(await v.query("hello"), []);
  });

  await t.step("remove deletes multiple entries", async () => {
    const v = createMemoryVectorStore();
    await v.upsert("a", "hello");
    await v.upsert("b", "hello");
    await v.upsert("c", "hello");
    await v.remove(["a", "b"]);
    const results = await v.query("hello");
    assertEquals(results.length, 1);
    assertEquals(results[0]!.id, "c");
  });

  await t.step("query returns original data", async () => {
    const v = createMemoryVectorStore();
    await v.upsert("doc", "The Capital of France");
    const results = await v.query("capital");
    assertEquals(results[0]!.data, "The Capital of France");
  });

  await t.step("query skips non-matching entries", async () => {
    const v = createMemoryVectorStore();
    await v.upsert("a", "apples and oranges");
    await v.upsert("b", "cats and dogs");
    const results = await v.query("apples");
    assertEquals(results.length, 1);
    assertEquals(results[0]!.id, "a");
  });
});

import { expect } from "@std/expect";
import { testCtx } from "@aai/server/testing";
import agent from "./agent.ts";

const ctx = testCtx();

Deno.test("night-owl - recommend movie picks", async () => {
  const result = (await agent.tools.recommend.handler(
    { category: "movie", mood: "spooky" },
    ctx,
  )) as Record<string, unknown>;
  expect(result.category).toBe("movie");
  expect(result.mood).toBe("spooky");
  expect(Array.isArray(result.picks)).toBe(true);
  expect((result.picks as string[]).length).toBe(3);
});

Deno.test("night-owl - recommend music picks", async () => {
  const result = (await agent.tools.recommend.handler(
    { category: "music", mood: "chill" },
    ctx,
  )) as Record<string, unknown>;
  expect((result.picks as string[])[0]).toContain("Khruangbin");
});

Deno.test("night-owl - recommend book picks", async () => {
  const result = (await agent.tools.recommend.handler(
    { category: "book", mood: "funny" },
    ctx,
  )) as Record<string, unknown>;
  expect((result.picks as string[])[0]).toContain("Good Omens");
});

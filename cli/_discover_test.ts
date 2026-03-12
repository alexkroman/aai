// Copyright 2025 the AAI authors. MIT license.
import { assertStrictEquals } from "@std/assert";
import {
  DEFAULT_SERVER,
  incrementName,
  slugFromDir,
  slugify,
} from "./_discover.ts";

Deno.test("slugify", async (t) => {
  await t.step("lowercases and replaces non-alphanumeric", () => {
    assertStrictEquals(slugify("Hello World"), "hello-world");
  });

  await t.step("strips leading and trailing hyphens", () => {
    assertStrictEquals(slugify("--hello--"), "hello");
  });

  await t.step("collapses multiple separators", () => {
    assertStrictEquals(slugify("a   b___c"), "a-b-c");
  });

  await t.step("returns empty for non-alphanumeric input", () => {
    assertStrictEquals(slugify("!!!"), "");
  });

  await t.step("handles already-slugified input", () => {
    assertStrictEquals(slugify("my-agent"), "my-agent");
  });
});

Deno.test("slugFromDir", async (t) => {
  await t.step("extracts slug from directory name", () => {
    assertStrictEquals(slugFromDir("/home/user/my-agent"), "my-agent");
  });

  await t.step("slugifies directory name", () => {
    assertStrictEquals(
      slugFromDir("/home/user/My Cool Agent"),
      "my-cool-agent",
    );
  });

  await t.step("returns 'agent' for non-alphanumeric dir", () => {
    assertStrictEquals(slugFromDir("/!!!"), "agent");
  });
});

Deno.test("incrementName", async (t) => {
  await t.step("appends -1 to name without number", () => {
    assertStrictEquals(incrementName("my-agent"), "my-agent-1");
  });

  await t.step("increments existing number suffix", () => {
    assertStrictEquals(incrementName("my-agent-1"), "my-agent-2");
    assertStrictEquals(incrementName("my-agent-99"), "my-agent-100");
  });

  await t.step("handles name that is just a number suffix", () => {
    assertStrictEquals(incrementName("agent-0"), "agent-1");
  });
});

Deno.test("DEFAULT_SERVER", () => {
  assertStrictEquals(DEFAULT_SERVER, "https://aai-agent.fly.dev");
});

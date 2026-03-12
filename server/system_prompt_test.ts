// Copyright 2025 the AAI authors. MIT license.
import { assert, assertStringIncludes } from "@std/assert";
import { buildSystemPrompt } from "./system_prompt.ts";
import { DEFAULT_INSTRUCTIONS } from "@aai/sdk/types";
import { makeConfig } from "./_test_utils.ts";

Deno.test("buildSystemPrompt", async (t) => {
  await t.step("includes default instructions", () => {
    const prompt = buildSystemPrompt(makeConfig(), false);
    assertStringIncludes(prompt, DEFAULT_INSTRUCTIONS);
  });

  await t.step("includes today's date", () => {
    const prompt = buildSystemPrompt(makeConfig(), false);
    const year = new Date().getFullYear();
    assertStringIncludes(prompt, String(year));
  });

  await t.step("includes agent-specific instructions", () => {
    const prompt = buildSystemPrompt(
      makeConfig({ instructions: "You are a pirate" }),
      false,
    );
    assertStringIncludes(prompt, "You are a pirate");
    assertStringIncludes(prompt, "Agent-Specific Instructions");
  });

  await t.step("always includes agent instructions section", () => {
    const prompt = buildSystemPrompt(makeConfig(), false);
    assertStringIncludes(prompt, "Agent-Specific Instructions");
    assertStringIncludes(prompt, "Test");
  });

  await t.step("includes tool reminder when tools provided", () => {
    const prompt = buildSystemPrompt(makeConfig(), true);
    assertStringIncludes(prompt, "final_answer");
    assertStringIncludes(prompt, "tool calling");
    assertStringIncludes(prompt, "Tool Preambles");
  });

  await t.step("omits tool reminder when no tools", () => {
    const prompt = buildSystemPrompt(makeConfig(), false);
    assert(!prompt.includes("final_answer"));
    assert(!prompt.includes("Tool Preambles"));
  });

  await t.step("appends voice rules when voice option set", () => {
    const prompt = buildSystemPrompt(makeConfig(), false, { voice: true });
    assertStringIncludes(prompt, "CRITICAL OUTPUT RULES");
    assertStringIncludes(prompt, "NEVER use markdown");
  });

  await t.step("omits voice rules by default", () => {
    const prompt = buildSystemPrompt(makeConfig(), false);
    assert(!prompt.includes("CRITICAL OUTPUT RULES"));
  });
});

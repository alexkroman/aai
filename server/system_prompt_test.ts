import { expect } from "@std/expect";
import { buildSystemPrompt } from "./system_prompt.ts";
import { DEFAULT_INSTRUCTIONS } from "@aai/sdk/types";
import { makeConfig } from "./_test_utils.ts";

Deno.test("buildSystemPrompt", async (t) => {
  await t.step("includes default instructions", () => {
    const prompt = buildSystemPrompt(makeConfig(), false);
    expect(prompt).toContain(DEFAULT_INSTRUCTIONS);
  });

  await t.step("includes today's date", () => {
    const prompt = buildSystemPrompt(makeConfig(), false);
    const year = new Date().getFullYear();
    expect(prompt).toContain(String(year));
  });

  await t.step("includes agent-specific instructions", () => {
    const prompt = buildSystemPrompt(
      makeConfig({ instructions: "You are a pirate" }),
      false,
    );
    expect(prompt).toContain("You are a pirate");
    expect(prompt).toContain("Agent-Specific Instructions");
  });

  await t.step("always includes agent instructions section", () => {
    const prompt = buildSystemPrompt(makeConfig(), false);
    expect(prompt).toContain("Agent-Specific Instructions");
    expect(prompt).toContain("Test");
  });

  await t.step("includes tool reminder when tools provided", () => {
    const prompt = buildSystemPrompt(makeConfig(), true);
    expect(prompt).toContain("provided tools");
  });

  await t.step("omits tool reminder when no tools", () => {
    const prompt = buildSystemPrompt(makeConfig(), false);
    expect(prompt).not.toContain("provided tools");
  });

  await t.step("appends voice rules when voice option set", () => {
    const prompt = buildSystemPrompt(makeConfig(), false, { voice: true });
    expect(prompt).toContain("CRITICAL OUTPUT RULES");
    expect(prompt).toContain("NEVER use markdown");
  });

  await t.step("omits voice rules by default", () => {
    const prompt = buildSystemPrompt(makeConfig(), false);
    expect(prompt).not.toContain("CRITICAL OUTPUT RULES");
  });

  await t.step("includes greeting instruction when greeting is set", () => {
    const prompt = buildSystemPrompt(makeConfig({ greeting: "Hello!" }), false);
    expect(prompt).toContain("say EXACTLY this and nothing else");
    expect(prompt).toContain('"Hello!"');
  });

  await t.step("omits greeting instruction when no greeting", () => {
    const prompt = buildSystemPrompt(makeConfig({ greeting: "" }), false);
    expect(prompt).not.toContain("GREETING");
  });
});

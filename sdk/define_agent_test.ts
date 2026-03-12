// Copyright 2025 the AAI authors. MIT license.
import { assertEquals, assertStrictEquals } from "@std/assert";
import { z } from "zod";
import { defineAgent } from "./define_agent.ts";
import { DEFAULT_GREETING, DEFAULT_INSTRUCTIONS } from "./types.ts";

Deno.test("defineAgent", async (t) => {
  await t.step("applies defaults", () => {
    const agent = defineAgent({ name: "Test" });
    assertStrictEquals(agent.name, "Test");
    assertStrictEquals(agent.voice, "luna");
    assertStrictEquals(agent.instructions, DEFAULT_INSTRUCTIONS);
    assertStrictEquals(agent.greeting, DEFAULT_GREETING);
    assertEquals(agent.transport, ["websocket"]);
    assertEquals(agent.env, ["ASSEMBLYAI_API_KEY"]);
    assertEquals(agent.tools, {});
  });

  await t.step("preserves custom values", () => {
    const agent = defineAgent({
      name: "Custom",
      voice: "orion",
      instructions: "Be a pirate",
      greeting: "Ahoy",
      transport: "twilio",
      env: ["MY_KEY"],
    });
    assertStrictEquals(agent.voice, "orion");
    assertStrictEquals(agent.instructions, "Be a pirate");
    assertStrictEquals(agent.greeting, "Ahoy");
    assertEquals(agent.transport, ["twilio"]);
    assertEquals(agent.env, ["MY_KEY"]);
  });

  await t.step("normalizes transport array", () => {
    const agent = defineAgent({
      name: "Multi",
      transport: ["websocket", "twilio"],
    });
    assertEquals(agent.transport, ["websocket", "twilio"]);
  });

  await t.step("preserves tools", () => {
    const tools = {
      greet: {
        description: "Say hello",
        parameters: z.object({ name: z.string() }),
        execute: ({ name }: Record<string, unknown>) => `Hello ${name}`,
      },
    };
    const agent = defineAgent({ name: "Test", tools });
    assertEquals(Object.keys(agent.tools), ["greet"]);
    assertStrictEquals(agent.tools.greet!.description, "Say hello");
  });

  await t.step("preserves lifecycle hooks", () => {
    const onConnect = () => {};
    const onDisconnect = () => {};
    const onError = () => {};
    const onTurn = () => {};
    const agent = defineAgent({
      name: "Test",
      onConnect,
      onDisconnect,
      onError,
      onTurn,
    });
    assertStrictEquals(agent.onConnect, onConnect);
    assertStrictEquals(agent.onDisconnect, onDisconnect);
    assertStrictEquals(agent.onError, onError);
    assertStrictEquals(agent.onTurn, onTurn);
  });

  await t.step("preserves sttPrompt, maxSteps, and builtinTools", () => {
    const agent = defineAgent({
      name: "Test",
      sttPrompt: "Transcribe accurately",
      maxSteps: 10,
      builtinTools: ["web_search", "run_code"],
    });
    assertStrictEquals(agent.sttPrompt, "Transcribe accurately");
    assertStrictEquals(agent.maxSteps, 10);
    assertEquals(agent.builtinTools, ["web_search", "run_code"]);
  });

  await t.step("maxSteps defaults to 5", () => {
    const agent = defineAgent({ name: "Test" });
    assertStrictEquals(agent.maxSteps, 5);
  });
});

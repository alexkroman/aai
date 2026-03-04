import { expect } from "@std/expect";
import { z } from "zod";
import { Agent } from "./agent.ts";
import { tool } from "./agent_types.ts";
import { DEFAULT_GREETING, DEFAULT_INSTRUCTIONS } from "./agent_types.ts";

Deno.test("Agent - fills defaults", () => {
  const agent = Agent({ name: "Minimal" });
  expect(agent.name).toBe("Minimal");
  expect(agent.voice).toBe("jess");
  expect(agent.instructions).toBe(DEFAULT_INSTRUCTIONS);
  expect(agent.greeting).toBe(DEFAULT_GREETING);
  expect(Object.keys(agent.tools).length).toBe(0);
});

Deno.test("Agent - preserves explicit config", () => {
  const agent = Agent({
    name: "TestAgent",
    instructions: "Custom instructions.",
    greeting: "Hi!",
    voice: "dan",
  });
  expect(agent.name).toBe("TestAgent");
  expect(agent.instructions).toBe("Custom instructions.");
  expect(agent.greeting).toBe("Hi!");
  expect(agent.voice).toBe("dan");
});

Deno.test("Agent - stores optional fields", () => {
  const agent = Agent({
    name: "Test",
    prompt: "Transcribe accurately",
    builtinTools: ["web_search"],
  });
  expect(agent.prompt).toBe("Transcribe accurately");
  expect(agent.builtinTools).toEqual(["web_search"]);
});

Deno.test("Agent - preserves tools and hooks", () => {
  const handler = () => {};
  const agent = Agent({
    name: "Test",
    tools: {
      greet: tool({
        description: "Greet",
        parameters: z.object({ name: z.string() }),
        handler: ({ name }) => `Hello, ${name}!`,
      }),
    },
    onConnect: handler,
  });
  expect("greet" in agent.tools).toBe(true);
  expect(agent.onConnect).toBe(handler);
});

Deno.test("Agent - tools are accessible for testing", async () => {
  const agent = Agent({
    name: "TestBot",
    tools: {
      echo: tool({
        description: "Echo input",
        parameters: z.object({ text: z.string() }),
        handler: ({ text }) => text,
      }),
    },
  });
  const result = await agent.tools.echo.handler(
    { text: "hello" },
    { secrets: {}, fetch: globalThis.fetch },
  );
  expect(result).toBe("hello");
});

Deno.test("Agent - returns frozen object", () => {
  const agent = Agent({ name: "Frozen" });
  expect(Object.isFrozen(agent)).toBe(true);
});

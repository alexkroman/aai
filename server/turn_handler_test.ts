// Copyright 2025 the AAI authors. MIT license.
import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import {
  type CoreMessage,
  jsonSchema,
  type LanguageModelV1,
  tool as vercelTool,
  type ToolSet,
} from "ai";
import { MockLanguageModelV1 } from "ai/test";
import { executeTurn } from "./turn_handler.ts";

function makeModel(
  responses: {
    text?: string;
    toolCalls?: { toolName: string; args: Record<string, unknown> }[];
  }[],
): LanguageModelV1 {
  let callIndex = 0;
  return new MockLanguageModelV1({
    doStream: async () => {
      const resp = responses[callIndex++] ??
        { text: "Sorry, I couldn't generate a response." };
      // deno-lint-ignore no-explicit-any
      const parts: any[] = [];
      if (resp.text !== undefined) {
        parts.push({ type: "text-delta", textDelta: resp.text });
      }
      if (resp.toolCalls) {
        for (const tc of resp.toolCalls) {
          parts.push({
            type: "tool-call",
            toolCallType: "function",
            toolCallId: `call_${callIndex}_${tc.toolName}`,
            toolName: tc.toolName,
            args: JSON.stringify(tc.args),
          });
        }
      }
      parts.push({
        type: "finish",
        finishReason: resp.toolCalls?.length ? "tool-calls" : "stop",
        usage: { promptTokens: 10, completionTokens: 10 },
      });
      return {
        rawCall: { rawPrompt: "", rawSettings: {} },
        stream: new ReadableStream({
          start(controller) {
            for (const p of parts) controller.enqueue(p);
            controller.close();
          },
        }),
      };
    },
  }) as LanguageModelV1;
}

function makeTools(): ToolSet {
  return {
    user_input: vercelTool({
      description: "Ask user",
      parameters: jsonSchema({
        type: "object",
        properties: { question: { type: "string" } },
      }),
    }) as unknown as ToolSet[string],
  };
}

/** Helper to consume a TurnResult and return the final text. */
async function consumeTurn(
  text: string,
  opts: Parameters<typeof executeTurn>[1],
): Promise<string> {
  const turn = executeTurn(text, opts);
  for await (const _chunk of turn.textStream) { /* drain */ }
  return await turn.text();
}

Deno.test("returns text response when no tools called", async () => {
  const model = makeModel([{ text: "Hello from LLM" }]);
  const messages: CoreMessage[] = [];
  const result = await consumeTurn("Hello", {
    agent: "test/agent",
    model,
    system: "You are helpful.",
    messages,
    tools: {},
    signal: new AbortController().signal,
  });
  assertStrictEquals(result, "Hello from LLM");
  assertEquals(messages[0], { role: "user", content: "Hello" });
  assert(messages.length >= 2);
});

Deno.test("extracts question from user_input tool call", async () => {
  const model = makeModel([{
    toolCalls: [{
      toolName: "user_input",
      args: { question: "What color?" },
    }],
  }]);
  const result = await consumeTurn("Help me", {
    agent: "test/agent",
    model,
    system: "You are helpful.",
    messages: [],
    tools: makeTools(),
    signal: new AbortController().signal,
  });
  assertStrictEquals(result, "What color?");
});

Deno.test("returns fallback text when LLM content is null", async () => {
  const model = makeModel([{}]);
  const result = await consumeTurn("Hi", {
    agent: "test/agent",
    model,
    system: "You are helpful.",
    messages: [],
    tools: {},
    signal: new AbortController().signal,
  });
  assertStrictEquals(result, "Sorry, I couldn't generate a response.");
});

// Copyright 2025 the AAI authors. MIT license.
import { assertEquals, assertStrictEquals } from "@std/assert";
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

/** Helper to consume a TurnResult's text stream and return the accumulated text. */
async function consumeTurn(
  text: string,
  opts: Parameters<typeof executeTurn>[1],
): Promise<string> {
  const turn = executeTurn(text, opts);
  let result = "";
  for await (const chunk of turn.textStream) {
    result += chunk;
  }
  return result;
}

Deno.test("streams text response when no tools called", async () => {
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
  // Messages are not mutated by turn_handler — caller manages history
  assertEquals(messages.length, 0);
});

Deno.test("streams empty text when only tool calls present", async () => {
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
  assertStrictEquals(result, "");
});

Deno.test("streams empty text when LLM content is null", async () => {
  const model = makeModel([{}]);
  const result = await consumeTurn("Hi", {
    agent: "test/agent",
    model,
    system: "You are helpful.",
    messages: [],
    tools: {},
    signal: new AbortController().signal,
  });
  assertStrictEquals(result, "");
});

import { expect } from "@std/expect";
import { stub } from "@std/testing/mock";
import { _internals, callLLM } from "./llm.ts";
import type { ChatMessage } from "./types.ts";
import type { ToolSchema } from "@aai/sdk/types";

// deno-lint-ignore no-explicit-any
function mockClient(response: any) {
  // deno-lint-ignore no-explicit-any
  let lastParams: any = null;
  const client = {
    chat: {
      completions: {
        // deno-lint-ignore no-explicit-any
        create(params: any, _opts?: any) {
          lastParams = params;
          return Promise.resolve(response);
        },
      },
    },
  };
  return {
    // deno-lint-ignore no-explicit-any
    createClient: (_key: string) => client as any,
    // deno-lint-ignore no-explicit-any
    lastParams: () => lastParams as any,
  };
}

const messages: ChatMessage[] = [
  { role: "system", content: "You are helpful." },
  { role: "user", content: "Hi" },
];

const okResponse = {
  id: "chatcmpl-test",
  choices: [{
    index: 0,
    message: { role: "assistant", content: "Hello!", tool_calls: null },
    finish_reason: "stop",
  }],
};

Deno.test("callLLM returns parsed text response", async () => {
  const mock = mockClient(okResponse);
  using _ = stub(_internals, "createClient", mock.createClient);
  const result = await callLLM({
    messages,
    tools: [],
    apiKey: "key",
    model: "model",
  });
  expect(result.choices[0].message.content).toBe("Hello!");
  expect(result.choices[0].finish_reason).toBe("stop");
});

Deno.test("callLLM passes system message through", async () => {
  const mock = mockClient(okResponse);
  using _ = stub(_internals, "createClient", mock.createClient);
  await callLLM({
    messages,
    tools: [],
    apiKey: "key",
    model: "model",
  });
  expect(mock.lastParams().messages[0].role).toBe("system");
  expect(mock.lastParams().messages[0].content).toBe("You are helpful.");
});

Deno.test("callLLM sends tools in OpenAI format", async () => {
  const mock = mockClient(okResponse);
  using _ = stub(_internals, "createClient", mock.createClient);
  const tools: ToolSchema[] = [{
    name: "get_weather",
    description: "Get weather",
    parameters: { type: "object", properties: {} },
  }];
  await callLLM({
    messages,
    tools,
    apiKey: "key",
    model: "model",
  });
  expect(mock.lastParams().tools).toHaveLength(1);
  expect(mock.lastParams().tools[0].function.name).toBe("get_weather");
});

Deno.test("callLLM converts tool_calls response", async () => {
  const mock = mockClient({
    id: "chatcmpl-test",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call_1",
          type: "function",
          function: { name: "get_weather", arguments: '{"city":"NYC"}' },
        }],
      },
      finish_reason: "tool_calls",
    }],
  });
  using _ = stub(_internals, "createClient", mock.createClient);
  const result = await callLLM({
    messages,
    tools: [{
      name: "get_weather",
      description: "Get weather",
      parameters: {},
    }],
    apiKey: "key",
    model: "model",
    toolChoice: "auto",
  });
  const tc = result.choices[0].message.tool_calls;
  expect(tc).toHaveLength(1);
  expect(tc![0].function.name).toBe("get_weather");
  expect(tc![0].function.arguments).toBe('{"city":"NYC"}');
});

Deno.test("callLLM sanitizes empty message content", async () => {
  const mock = mockClient(okResponse);
  using _ = stub(_internals, "createClient", mock.createClient);
  const msgs: ChatMessage[] = [
    { role: "system", content: "sys" },
    { role: "user", content: "" },
    { role: "assistant", content: "ok" },
    { role: "user", content: "   " },
  ];
  await callLLM({
    messages: msgs,
    tools: [],
    apiKey: "key",
    model: "model",
  });
  const params = mock.lastParams();
  expect(params.messages[1].content).toBe("...");
  expect(params.messages[3].content).toBe("...");
});

Deno.test("callLLM sanitizes tool_call arguments", async () => {
  const mock = mockClient(okResponse);
  using _ = stub(_internals, "createClient", mock.createClient);
  const msgs: ChatMessage[] = [
    { role: "system", content: "sys" },
    { role: "user", content: "Hi" },
    {
      role: "assistant",
      content: "",
      tool_calls: [{
        id: "call_1",
        type: "function" as const,
        function: { name: "search", arguments: "" },
      }],
    },
    { role: "tool", content: "result", tool_call_id: "call_1" },
  ];
  await callLLM({
    messages: msgs,
    tools: [],
    apiKey: "key",
    model: "model",
  });
  const params = mock.lastParams();
  const tc = params.messages[2].tool_calls[0];
  // Gateway workaround: empty args get a dummy key to avoid gateway bug
  expect(tc.function.arguments).toBe('{"_":""}');
});

import { expect } from "@std/expect";
import { callLLM } from "./llm.ts";
import type { ChatMessage, ToolSchema } from "./types.ts";

function mockFetch(
  body: string,
  status = 200,
): {
  fetch: typeof globalThis.fetch;
  lastRequest: () => { url: string; init: RequestInit } | null;
} {
  let _lastRequest: { url: string; init: RequestInit } | null = null;
  const fetchFn = ((
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    _lastRequest = { url, init: init ?? {} };
    return Promise.resolve(new Response(body, { status }));
  }) as typeof globalThis.fetch;
  return { fetch: fetchFn, lastRequest: () => _lastRequest };
}

const jsonBody = (obj: unknown) => JSON.stringify(obj);

const validResponse = {
  id: "chatcmpl-test",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "Hello!" },
      finish_reason: "stop",
    },
  ],
};

const messages: ChatMessage[] = [
  { role: "system", content: "You are helpful." },
  { role: "user", content: "Hi" },
];

Deno.test("callLLM", async (t) => {
  await t.step("sends correct request shape", async () => {
    const ctx = mockFetch(jsonBody(validResponse));
    await callLLM({
      messages,
      tools: [],
      apiKey: "test-key",
      model: "test-model",
      fetch: ctx.fetch,
    });

    const lastRequest = ctx.lastRequest();
    expect(lastRequest).not.toBeNull();
    expect(lastRequest!.url).toContain("/chat/completions");
    const init = lastRequest!.init;
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-key");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("test-model");
    expect(body.messages).toHaveLength(2);
  });

  await t.step("sanitizes empty message content to '...'", async () => {
    const ctx = mockFetch(jsonBody(validResponse));
    const msgs: ChatMessage[] = [
      { role: "user", content: "" },
      { role: "user", content: "   " },
    ];
    await callLLM({
      messages: msgs,
      tools: [],
      apiKey: "key",
      model: "model",
      fetch: ctx.fetch,
    });

    const body = JSON.parse(ctx.lastRequest()!.init.body as string);
    expect(body.messages[0].content).toBe("...");
    expect(body.messages[1].content).toBe("...");
  });

  await t.step("includes tools when provided", async () => {
    const ctx = mockFetch(jsonBody(validResponse));
    const tools: ToolSchema[] = [
      {
        name: "get_weather",
        description: "Get weather",
        parameters: { type: "object", properties: {} },
      },
    ];
    await callLLM({
      messages,
      tools,
      apiKey: "key",
      model: "model",
      fetch: ctx.fetch,
    });

    const body = JSON.parse(ctx.lastRequest()!.init.body as string);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].type).toBe("function");
    expect(body.tools[0].function.name).toBe("get_weather");
  });

  await t.step("does not include tools when list is empty", async () => {
    const ctx = mockFetch(jsonBody(validResponse));
    await callLLM({
      messages,
      tools: [],
      apiKey: "key",
      model: "model",
      fetch: ctx.fetch,
    });

    const body = JSON.parse(ctx.lastRequest()!.init.body as string);
    expect(body.tools).toBeUndefined();
  });

  await t.step("parses valid response", async () => {
    const ctx = mockFetch(jsonBody(validResponse));
    const result = await callLLM({
      messages,
      tools: [],
      apiKey: "key",
      model: "model",
      fetch: ctx.fetch,
    });
    expect(result.choices[0].message.content).toBe("Hello!");
    expect(result.choices[0].finish_reason).toBe("stop");
  });

  await t.step("throws on non-OK response", async () => {
    const ctx = mockFetch("Unauthorized", 401);
    await expect(
      callLLM({
        messages,
        tools: [],
        apiKey: "key",
        model: "model",
        fetch: ctx.fetch,
      }),
    ).rejects.toThrow(/401/);
  });

  await t.step("throws on invalid response shape", async () => {
    const ctx = mockFetch(jsonBody({ invalid: true }));
    await expect(
      callLLM({
        messages,
        tools: [],
        apiKey: "key",
        model: "model",
        fetch: ctx.fetch,
      }),
    ).rejects.toThrow(/Invalid LLM response/);
  });

  await t.step("uses custom gateway base URL", async () => {
    const ctx = mockFetch(jsonBody(validResponse));
    await callLLM({
      messages,
      tools: [],
      apiKey: "key",
      model: "model",
      gatewayBase: "https://custom.gateway.com/v1",
      fetch: ctx.fetch,
    });
    expect(ctx.lastRequest()!.url).toContain("custom.gateway.com");
  });

  await t.step("uses default gateway when none specified", async () => {
    const ctx = mockFetch(jsonBody(validResponse));
    await callLLM({
      messages,
      tools: [],
      apiKey: "key",
      model: "model",
      fetch: ctx.fetch,
    });
    expect(ctx.lastRequest()!.url).toContain("llm-gateway.assemblyai.com");
  });

  await t.step(
    "uses injectable fetch option instead of globalThis.fetch",
    async () => {
      let customFetchCalled = false;
      const baseFetch = mockFetch(jsonBody(validResponse));
      const customFetch = ((...args: Parameters<typeof fetch>) => {
        customFetchCalled = true;
        return baseFetch.fetch(...args);
      }) as typeof globalThis.fetch;

      await callLLM({
        messages,
        tools: [],
        apiKey: "key",
        model: "model",
        fetch: customFetch,
      });

      expect(customFetchCalled).toBe(true);
    },
  );
});

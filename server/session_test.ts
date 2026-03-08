import { expect } from "@std/expect";
import { createSession, type SessionDeps } from "./session.ts";
import type { AgentConfig, ToolSchema } from "../sdk/types.ts";
import {
  createMockLLMResponse,
  createMockSessionOptions,
  type createMockTransport,
  getSentJson,
  responses,
} from "./_test_utils.ts";
import type { SttEvents } from "./stt.ts";

type SetupOverrides = Partial<SessionDeps> & { toolSchemas?: ToolSchema[] };

function setup(
  overrides?: SetupOverrides,
  agentConfig?: Partial<AgentConfig>,
) {
  const { toolSchemas, ...depsOverrides } = overrides ?? {};
  const mocks = createMockSessionOptions(depsOverrides);
  if (agentConfig) {
    mocks.opts.agentConfig = { ...mocks.opts.agentConfig, ...agentConfig };
  }
  if (toolSchemas) {
    mocks.opts.toolSchemas = toolSchemas;
  }
  const transport = mocks.opts.transport as ReturnType<
    typeof createMockTransport
  >;
  const session = createSession(mocks.opts);
  return { session, transport, ...mocks };
}

function setupWithSttEvents(
  overrides?: SetupOverrides,
  agentConfig?: Partial<AgentConfig>,
) {
  const events: { current: SttEvents | null } = { current: null };
  const result = setup(
    {
      connectStt: (_key: string, _config: unknown, sttEvents: SttEvents) => {
        events.current = sttEvents;
        return Promise.resolve({
          send: () => {},
          clear: () => {},
          close: () => {},
        });
      },
      ...overrides,
    },
    agentConfig,
  );
  return { ...result, events };
}

Deno.test("start sends READY message with sample rates", async () => {
  const { session, transport } = setup();
  await session.start();
  const messages = getSentJson(transport);
  const ready = messages.find((m) => m.type === "ready");
  expect(ready).toBeDefined();
  expect(ready!.sample_rate).toBeDefined();
  expect(ready!.tts_sample_rate).toBeDefined();
});

Deno.test("start defers greeting until onAudioReady", () => {
  const { session, transport } = setup();
  session.start();
  const messages = getSentJson(transport);
  expect(messages.filter((m) => m.type === "chat")).toHaveLength(0);
});

Deno.test("start sends error on STT connection failure", async () => {
  const { session, transport } = setup({
    connectStt: () => {
      throw new Error("STT connection refused");
    },
  });
  await session.start();
  expect(getSentJson(transport).find((m) => m.type === "error")).toBeDefined();
});

Deno.test("onAudioReady sends greeting and starts TTS", async () => {
  const { session, transport, ttsClient } = setup();
  await session.start();
  session.onAudioReady();
  const chat = getSentJson(transport).find((m) => m.type === "chat");
  expect(chat!.text).toBe("Hi there!");
  expect(ttsClient.synthesizeStreamCalls).toBeGreaterThan(0);
});

Deno.test("onAudioReady is a no-op on second call", async () => {
  const { session, ttsClient } = setup();
  await session.start();
  session.onAudioReady();
  const firstCount = ttsClient.synthesizeStreamCalls;
  session.onAudioReady();
  expect(ttsClient.synthesizeStreamCalls).toBe(firstCount);
});

Deno.test("onAudio relays data to STT handle", async () => {
  const { session, sttHandle } = setup();
  await session.start();
  session.onAudio(new Uint8Array([1, 2, 3]));
  expect(sttHandle.sentData.length).toBe(1);
});

Deno.test("onAudio does not throw before STT is connected", () => {
  const { session } = setup({
    connectStt: () => new Promise(() => {}),
  });
  session.start();
  expect(() => session.onAudio(new Uint8Array([1]))).not.toThrow();
});

Deno.test("onCancel clears STT and sends CANCELLED", async () => {
  const { session, transport, sttHandle } = setup();
  await session.start();
  session.onCancel();
  expect(sttHandle.clearCalled).toBe(true);
  expect(getSentJson(transport).find((m) => m.type === "cancelled"))
    .toBeDefined();
});

Deno.test("onReset sends RESET and re-sends greeting", async () => {
  const { session, transport, sttHandle } = setup();
  await session.start();
  session.onReset();
  expect(sttHandle.clearCalled).toBe(true);
  const messages = getSentJson(transport);
  expect(messages.find((m) => m.type === "reset")).toBeDefined();
  expect(messages.filter((m) => m.type === "chat").length).toBeGreaterThan(0);
});

Deno.test("handleTurn sends TURN, CHAT, triggers TTS", async () => {
  const ctx = setupWithSttEvents();
  await ctx.session.start();
  ctx.events.current!.onTurn("What is the weather?");
  await ctx.session.waitForTurn();

  const messages = getSentJson(ctx.transport);
  expect(messages.find((m) => m.type === "turn")!.text).toBe(
    "What is the weather?",
  );
  expect(messages.find((m) => m.type === "chat")!.text).toBe(
    "Hello from LLM",
  );
  expect(ctx.ttsClient.synthesizeStreamCalls).toBeGreaterThan(0);
});

Deno.test("handleTurn handles tool calls", async () => {
  const toolResponse = createMockLLMResponse(null, [
    { id: "call1", name: "get_weather", arguments: '{"city":"NYC"}' },
  ]);
  const finalResponse = createMockLLMResponse("It's sunny in NYC.");

  const ctx = setupWithSttEvents({
    callLLM: responses(toolResponse, finalResponse),
    toolSchemas: [
      {
        name: "get_weather",
        description: "Get weather",
        parameters: { type: "object", properties: {} },
      },
    ],
  });
  await ctx.session.start();
  ctx.events.current!.onTurn("What's the weather in NYC?");
  await ctx.session.waitForTurn();

  expect(ctx.executeTool.calls.length).toBe(1);
  expect(ctx.executeTool.calls[0].name).toBe("get_weather");
  expect(getSentJson(ctx.transport).find((m) => m.type === "chat")!.text).toBe(
    "It's sunny in NYC.",
  );
});

Deno.test("handleTurn sends ERROR on LLM failure", async () => {
  const ctx = setupWithSttEvents({
    callLLM: () => {
      throw new Error("LLM unavailable");
    },
  });
  await ctx.session.start();
  ctx.events.current!.onTurn("Hello");
  await ctx.session.waitForTurn();
  expect(getSentJson(ctx.transport).find((m) => m.type === "error"))
    .toBeDefined();
});

Deno.test("handleTurn sends TTS_DONE for empty response", async () => {
  const ctx = setupWithSttEvents({
    callLLM: () => Promise.resolve(createMockLLMResponse("")),
  });
  await ctx.session.start();
  ctx.events.current!.onTurn("Hello");
  await ctx.session.waitForTurn();
  expect(getSentJson(ctx.transport).find((m) => m.type === "tts_done"))
    .toBeDefined();
});

Deno.test("relays STT partial transcript to browser", async () => {
  const ctx = setupWithSttEvents();
  await ctx.session.start();
  ctx.events.current!.onTranscript("partial text", false);
  const transcript = getSentJson(ctx.transport).find((m) =>
    m.type === "partial_transcript"
  );
  expect(transcript!.text).toBe("partial text");
});

Deno.test("relays STT final transcript to browser", async () => {
  const ctx = setupWithSttEvents();
  await ctx.session.start();
  ctx.events.current!.onTranscript("done", true, 3);
  const transcript = getSentJson(ctx.transport).find((m) =>
    m.type === "final_transcript"
  );
  expect(transcript!.text).toBe("done");
  expect(transcript!.turn_order).toBe(3);
});

Deno.test("omits turn_order on final transcript when undefined", async () => {
  const ctx = setupWithSttEvents();
  await ctx.session.start();
  ctx.events.current!.onTranscript("done", true);
  const transcript = getSentJson(ctx.transport).find((m) =>
    m.type === "final_transcript"
  );
  expect(transcript!.turn_order).toBeUndefined();
});

Deno.test("forwards turn_order in turn messages", async () => {
  const ctx = setupWithSttEvents();
  await ctx.session.start();
  ctx.events.current!.onTurn("What is the weather?", 5);
  await ctx.session.waitForTurn();
  const turn = getSentJson(ctx.transport).find((m) => m.type === "turn");
  expect(turn!.turn_order).toBe(5);
});

Deno.test("trySendJson silently drops messages when WS is closed", () => {
  const mocks = createMockSessionOptions();
  mocks.opts.transport = {
    sent: [] as (string | ArrayBuffer | Uint8Array)[],
    readyState: 3,
    send(data: string | ArrayBuffer | Uint8Array) {
      (this as { sent: (string | ArrayBuffer | Uint8Array)[] }).sent.push(data);
    },
  } as unknown as ReturnType<typeof createMockTransport>;
  const session = createSession(mocks.opts);
  session.start();
  expect(
    (mocks.opts.transport as unknown as { sent: unknown[] }).sent,
  ).toHaveLength(0);
});

Deno.test("stop closes STT and TTS", async () => {
  const { session, sttHandle, ttsClient } = setup();
  await session.start();
  await session.stop();
  expect(sttHandle.closeCalled).toBe(true);
  expect(ttsClient.closeCalled).toBe(true);
});

Deno.test("stop is idempotent", async () => {
  const { session, ttsClient } = setup();
  await session.start();
  await session.stop();
  const firstCloseCount = ttsClient.closeCalled;
  await session.stop();
  expect(ttsClient.closeCalled).toBe(firstCloseCount);
});

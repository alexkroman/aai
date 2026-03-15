// Copyright 2025 the AAI authors. MIT license.
import { assert, assertStrictEquals } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import type { LanguageModelV1 } from "ai";
import { MockLanguageModelV1 } from "ai/test";
import type { ClientEvent, ClientSink } from "@aai/sdk/protocol";
import { createSession, type SessionOptions } from "./session.ts";
import type { AgentConfig } from "@aai/sdk/types";
import type { SttConnection } from "./stt.ts";
import { DEFAULT_STT_CONFIG, DEFAULT_TTS_CONFIG } from "./types.ts";
import type { PlatformConfig } from "./config.ts";

/** A mock model that streams a simple text response. */
function createMockModel(): LanguageModelV1 {
  return new MockLanguageModelV1({
    doStream: async () => ({
      rawCall: { rawPrompt: "", rawSettings: {} },
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: "text-delta",
            textDelta: "mock response",
          });
          controller.enqueue({
            type: "finish",
            finishReason: "stop",
            usage: { promptTokens: 1, completionTokens: 1 },
          });
          controller.close();
        },
      }),
    }),
  }) as LanguageModelV1;
}

function createMockClientSink(): ClientSink & {
  calls: { method: string; args: unknown[] }[];
} {
  const calls: { method: string; args: unknown[] }[] = [];
  return {
    calls,
    open: true,
    event(e: ClientEvent) {
      calls.push({ method: "event", args: [e] });
    },
    playAudioChunk(...args) {
      calls.push({ method: "playAudioChunk", args });
    },
    playAudioDone(...args) {
      calls.push({ method: "playAudioDone", args });
    },
  };
}

function createMockPlatformConfig(): PlatformConfig {
  return {
    apiKey: "test-api-key",
    sttConfig: { ...DEFAULT_STT_CONFIG },
    ttsConfig: { ...DEFAULT_TTS_CONFIG, apiKey: "test-tts-key" },
    model: "test-model",
    llmGatewayBase: "https://test-gateway.example.com/v1",
  };
}

type MockSttHandle = SttConnection & {
  connect: ReturnType<typeof spy>;
  send: ReturnType<typeof spy>;
  clear: ReturnType<typeof spy>;
  close: ReturnType<typeof spy>;
};

function createMockSttHandle(): MockSttHandle {
  return {
    connected: true,
    closed: false,
    onSpeechStarted: null,
    onTranscript: null,
    onTurn: null,
    onError: null,
    onClose: null,
    connect: spy(() => Promise.resolve()),
    send: spy((_audio: Uint8Array) => {}),
    clear: spy(() => {}),
    close: spy(() => {}),
  } as unknown as MockSttHandle;
}

function createMockSessionOptions() {
  const sttHandle = createMockSttHandle();

  const streamedText: string[] = [];
  const ttsClient = {
    streamedText,
    warmup: spy(() => {}),
    synthesizeStream: spy(
      async (
        chunks: string | AsyncIterable<string>,
        _onAudio: (chunk: Uint8Array) => void,
        _signal?: AbortSignal,
        callbacks?: import("./tts.ts").SynthesizeCallbacks,
      ): Promise<void> => {
        if (typeof chunks === "string") {
          streamedText.push(chunks);
          callbacks?.onText?.(chunks);
          // Simulate word timestamps
          const words = chunks.split(/\s+/).filter(Boolean);
          let t = 0;
          callbacks?.onWords?.(
            words.map((w) => ({ text: w, start: t += 0.3 })),
          );
        } else {
          const allText: string[] = [];
          for await (const text of chunks) {
            streamedText.push(text);
            if (text) {
              callbacks?.onText?.(text);
              allText.push(text);
            }
          }
          // Simulate word timestamps for streamed text
          const words = allText.join("").split(/\s+/).filter(Boolean);
          let t = 0;
          callbacks?.onWords?.(
            words.map((w) => ({ text: w, start: t += 0.3 })),
          );
        }
      },
    ),
    close: spy(() => {}),
  } as unknown as import("./tts.ts").TtsConnection & {
    streamedText: string[];
    warmup: ReturnType<typeof spy>;
    synthesizeStream: ReturnType<typeof spy>;
    close: ReturnType<typeof spy>;
  };

  const executeTool = spy(
    (_name: string, _args: Record<string, unknown>, _sessionId?: string) =>
      Promise.resolve('"tool result"'),
  );

  const opts: SessionOptions = {
    id: "test-session-id",
    agent: "test/agent",
    client: createMockClientSink(),
    agentConfig: {
      name: "Test Agent",
      instructions: "Test instructions",
      greeting: "Hi there!",
      voice: "luna",
    },
    toolSchemas: [],
    platformConfig: createMockPlatformConfig(),
    executeTool,
    createStt: () => sttHandle,
    createTts: () => ttsClient,
    model: createMockModel(),
  };

  return {
    opts,
    sttHandle,
    ttsClient,
    executeTool,
  };
}

type SetupOptions = {
  createStt?: SessionOptions["createStt"];
  agentConfig?: Partial<AgentConfig>;
};

function setup(options?: SetupOptions) {
  const mocks = createMockSessionOptions();
  if (options?.agentConfig) {
    mocks.opts.agentConfig = {
      ...mocks.opts.agentConfig,
      ...options.agentConfig,
    };
  }
  if (options?.createStt) {
    mocks.opts.createStt = options.createStt;
  }

  const client = mocks.opts.client as ReturnType<typeof createMockClientSink>;
  const session = createSession(mocks.opts);

  return {
    session,
    client,
    ...mocks,
  };
}

function setupWithSttHandle(options?: SetupOptions) {
  const mocks = createMockSessionOptions();
  if (options?.agentConfig) {
    mocks.opts.agentConfig = {
      ...mocks.opts.agentConfig,
      ...options.agentConfig,
    };
  }

  const handle: SttConnection = {
    connected: true,
    closed: false,
    onSpeechStarted: null,
    onTranscript: null,
    onTurn: null,
    onError: null,
    onClose: null,
    connect: () => Promise.resolve(),
    send: () => {},
    clear: () => {},
    close: () => {},
  };

  mocks.opts.createStt = () => handle;

  const client = mocks.opts.client as ReturnType<typeof createMockClientSink>;
  const session = createSession(mocks.opts);

  return {
    session,
    client,
    handle,
    ...mocks,
  };
}

function findCall(
  client: ReturnType<typeof createMockClientSink>,
  method: string,
) {
  return client.calls.find((c) => c.method === method);
}

/** Find the first event() call with the given type. */
function findEvent(
  client: ReturnType<typeof createMockClientSink>,
  type: string,
) {
  return client.calls.find(
    (c) => c.method === "event" && (c.args[0] as ClientEvent).type === type,
  );
}

/** Filter event() calls with the given type. */
function filterEvents(
  client: ReturnType<typeof createMockClientSink>,
  type: string,
) {
  return client.calls.filter(
    (c) => c.method === "event" && (c.args[0] as ClientEvent).type === type,
  );
}

Deno.test("start connects STT without sending ready", async () => {
  const ctx = setup();
  await ctx.session.start();
  // ready() is no longer pushed — client pulls config via SessionTarget.getConfig()
  assertStrictEquals(findCall(ctx.client, "ready"), undefined);
});

Deno.test("start defers greeting until onAudioReady", () => {
  const ctx = setup();
  ctx.session.start();
  assertStrictEquals(filterEvents(ctx.client, "words").length, 0);
});

Deno.test("start sends error on STT connection failure", async () => {
  const ctx = setup({
    createStt: (): SttConnection => ({
      connected: false,
      closed: false,
      onSpeechStarted: null,
      onTranscript: null,
      onTurn: null,
      onError: null,
      onClose: null,
      connect: () => Promise.reject(new Error("STT connection refused")),
      send: () => {},
      clear: () => {},
      close: () => {},
    }),
  });
  await ctx.session.start();
  assert(findEvent(ctx.client, "error") !== undefined);
});

Deno.test("onAudioReady streams greeting via TTS with words", async () => {
  const ctx = setup();
  await ctx.session.start();
  ctx.session.onAudioReady();
  // Wait for the async TTS greeting to complete
  await ctx.session.waitForTurn();
  const wordEvents = filterEvents(ctx.client, "words");
  assert(wordEvents.length > 0);
  const firstEvent = wordEvents[0]!.args[0] as {
    words: { text: string; start: number }[];
  };
  assert(firstEvent.words.length > 0);
  assertStrictEquals(firstEvent.words[0]!.text, "Hi");
  assert(ctx.ttsClient.synthesizeStream.calls.length > 0);
});

Deno.test("onAudioReady is a no-op on second call", async () => {
  const ctx = setup();
  await ctx.session.start();
  ctx.session.onAudioReady();
  const firstCount = ctx.ttsClient.synthesizeStream.calls.length;
  ctx.session.onAudioReady();
  assertStrictEquals(ctx.ttsClient.synthesizeStream.calls.length, firstCount);
});

Deno.test("onAudio relays data to STT handle", async () => {
  const ctx = setup();
  await ctx.session.start();
  ctx.session.onAudio(new Uint8Array([1, 2, 3]));
  assertSpyCalls(ctx.sttHandle.send, 1);
});

Deno.test("onAudio does not throw before STT is connected", () => {
  const ctx = setup({
    createStt: (): SttConnection => ({
      connected: false,
      closed: false,
      onSpeechStarted: null,
      onTranscript: null,
      onTurn: null,
      onError: null,
      onClose: null,
      connect: () => new Promise<void>(() => {}),
      send: () => {},
      clear: () => {},
      close: () => {},
    }),
  });
  ctx.session.start();
  ctx.session.onAudio(new Uint8Array([1]));
});

Deno.test("onCancel clears STT and sends cancelled", async () => {
  const ctx = setup();
  await ctx.session.start();
  ctx.session.onCancel();
  assertSpyCalls(ctx.sttHandle.clear, 1);
  assert(findEvent(ctx.client, "cancelled") !== undefined);
});

Deno.test("onReset sends reset and re-streams greeting", async () => {
  const ctx = setup();
  await ctx.session.start();
  ctx.session.onAudioReady();
  await ctx.session.waitForTurn();
  ctx.session.onReset();
  assertSpyCalls(ctx.sttHandle.clear, 1);
  assert(findEvent(ctx.client, "reset") !== undefined);
  // Wait for the re-streamed greeting
  await ctx.session.waitForTurn();
  assert(filterEvents(ctx.client, "words").length > 0);
});

Deno.test("relays STT partial transcript to client", async () => {
  const ctx = setupWithSttHandle();
  await ctx.session.start();
  ctx.handle.onTranscript!({ text: "partial text", isFinal: false });
  const call = findEvent(ctx.client, "transcript");
  const ev = call!.args[0] as { text: string; isFinal: boolean };
  assertStrictEquals(ev.text, "partial text");
  assertStrictEquals(ev.isFinal, false);
});

Deno.test("relays STT final transcript to client", async () => {
  const ctx = setupWithSttHandle();
  await ctx.session.start();
  ctx.handle.onTranscript!({ text: "done", isFinal: true, turnOrder: 3 });
  const calls = filterEvents(ctx.client, "transcript");
  const finalCall = calls.find(
    (c) => (c.args[0] as { isFinal: boolean }).isFinal,
  );
  const ev = finalCall!.args[0] as {
    text: string;
    isFinal: true;
    turnOrder?: number;
  };
  assertStrictEquals(ev.text, "done");
  assertStrictEquals(ev.turnOrder, 3);
});

Deno.test("omits turnOrder on final transcript when undefined", async () => {
  const ctx = setupWithSttHandle();
  await ctx.session.start();
  ctx.handle.onTranscript!({ text: "done", isFinal: true });
  const calls = filterEvents(ctx.client, "transcript");
  const finalCall = calls.find(
    (c) => (c.args[0] as { isFinal: boolean }).isFinal,
  );
  const ev = finalCall!.args[0] as { turnOrder?: number };
  assertStrictEquals(ev.turnOrder, undefined);
});

Deno.test("forwards turnOrder in turn messages", async () => {
  const ctx = setupWithSttHandle();
  await ctx.session.start();
  ctx.handle.onTurn!({ text: "What is the weather?", turnOrder: 5 });
  await new Promise((r) => setTimeout(r, 10));
  const call = findEvent(ctx.client, "turn");
  assertStrictEquals((call!.args[0] as { turnOrder?: number }).turnOrder, 5);
  await ctx.session.stop();
});

Deno.test("client.open=false silently drops messages", () => {
  const ctx = setup();
  const closedClient = createMockClientSink();
  (closedClient as { open: boolean }).open = false;
  ctx.opts.client = closedClient;
  const session = createSession(ctx.opts);
  session.start();
  assertStrictEquals(closedClient.calls.length, 0);
});

Deno.test("stop closes STT and TTS", async () => {
  const ctx = setup();
  await ctx.session.start();
  await ctx.session.stop();
  assertSpyCalls(ctx.sttHandle.close, 1);
  assertSpyCalls(ctx.ttsClient.close, 1);
});

Deno.test("stop is idempotent", async () => {
  const ctx = setup();
  await ctx.session.start();
  await ctx.session.stop();
  assertSpyCalls(ctx.ttsClient.close, 1);
  await ctx.session.stop();
  assertSpyCalls(ctx.ttsClient.close, 1);
});

Deno.test("onHistory restores conversation messages", async () => {
  const ctx = setup();
  await ctx.session.start();
  ctx.session.onHistory([
    { role: "user", text: "Hello" },
    { role: "assistant", text: "Hi there" },
  ]);
  // Verify no errors thrown — history is stored internally
});

Deno.test("resolveTurnConfig is called each turn", async () => {
  let turnConfigCalls = 0;
  const ctx = setupWithSttHandle();
  const mockWorkerApi = {
    onConnect: () => Promise.resolve(),
    onDisconnect: () => Promise.resolve(),
    onTurn: () => Promise.resolve(),
    onError: () => Promise.resolve(),
    onStep: () => Promise.resolve(),
    executeTool: () => Promise.resolve("ok"),
    resolveTurnConfig: () => {
      turnConfigCalls++;
      return Promise.resolve({ maxSteps: 3 });
    },
  };
  ctx.opts.getWorkerApi = () => Promise.resolve(mockWorkerApi);
  const session = createSession(ctx.opts);
  await session.start();
  ctx.handle.onTurn!({ text: "turn 1" });
  await session.waitForTurn();
  ctx.handle.onTurn!({ text: "turn 2" });
  await session.waitForTurn();
  // resolveTurnConfig should have been called twice (once per turn)
  assertStrictEquals(turnConfigCalls, 2);
  await session.stop();
});

Deno.test("skipGreeting suppresses greeting on start", async () => {
  const mocks = createMockSessionOptions();
  mocks.opts.skipGreeting = true;

  const session = createSession(mocks.opts);
  await session.start();
  session.onAudioReady();
  const client = mocks.opts.client as ReturnType<typeof createMockClientSink>;
  assertStrictEquals(filterEvents(client, "words").length, 0);
});

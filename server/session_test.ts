import { expect } from "@std/expect";
import { spy } from "@std/testing/mock";
import {
  createSession,
  type SessionOptions,
  type SessionTransport,
} from "./session.ts";
import type { AgentConfig } from "@aai/sdk/types";
import type { S2sHandle } from "./s2s.ts";
import { DEFAULT_S2S_CONFIG } from "./types.ts";
import type { PlatformConfig } from "./config.ts";

function createMockTransport(): SessionTransport & {
  sent: (string | ArrayBuffer | Uint8Array)[];
} {
  const sent: (string | ArrayBuffer | Uint8Array)[] = [];
  return {
    sent,
    readyState: 1,
    send(data: string | ArrayBuffer | Uint8Array) {
      sent.push(data);
    },
  };
}

function getSentJson(
  transport: ReturnType<typeof createMockTransport>,
): Record<string, unknown>[] {
  return transport.sent
    .filter((d): d is string => typeof d === "string")
    .map((s) => JSON.parse(s));
}

function getSentBinary(
  transport: ReturnType<typeof createMockTransport>,
): Uint8Array[] {
  return transport.sent.filter((d): d is Uint8Array => d instanceof Uint8Array);
}

function createMockPlatformConfig(): PlatformConfig {
  return {
    apiKey: "test-api-key",
    s2sConfig: { ...DEFAULT_S2S_CONFIG },
  };
}

function createMockS2sHandle(): S2sHandle {
  return Object.assign(new EventTarget(), {
    sendAudio: spy((_audio: Uint8Array) => {}),
    sendToolResult: spy((_callId: string, _result: string) => {}),
    updateSession: spy((_config: Record<string, unknown>) => {}),
    resumeSession: spy((_sessionId: string) => {}),
    close: spy(() => {}),
  }) as S2sHandle;
}

function createMockSessionOptions() {
  const s2sHandle = createMockS2sHandle();

  const executeTool = spy(
    (_name: string, _args: Record<string, unknown>, _sessionId?: string) =>
      Promise.resolve('"tool result"'),
  );

  const opts: SessionOptions = {
    id: "test-session-id",
    agent: "test/agent",
    transport: createMockTransport(),
    agentConfig: {
      name: "Test Agent",
      instructions: "Test instructions",
      greeting: "Hi there!",
      voice: "luna",
    },
    toolSchemas: [],
    platformConfig: createMockPlatformConfig(),
    executeTool,
    connectS2s: () => Promise.resolve(s2sHandle),
  };

  return {
    opts,
    s2sHandle,
    executeTool,
  };
}

type SetupOptions = {
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

  const transport = mocks.opts.transport as ReturnType<
    typeof createMockTransport
  >;
  const session = createSession(mocks.opts);

  return {
    session,
    transport,
    ...mocks,
  };
}

Deno.test("start sends READY message with protocol v2 metadata", async () => {
  const ctx = setup();
  await ctx.session.start();
  const messages = getSentJson(ctx.transport);
  const ready = messages.find((m) => m.type === "ready");
  expect(ready).toBeDefined();
  expect(ready!.protocol_version).toBe(2);
  expect(ready!.audio_format).toBe("pcm16");
  expect(ready!.input_sample_rate).toBe(16_000);
  expect(ready!.output_sample_rate).toBe(24_000);
});

Deno.test("start sends session.update on S2S ready event", async () => {
  const ctx = setup();
  await ctx.session.start();
  // Simulate S2S ready event
  ctx.s2sHandle.dispatchEvent(
    new CustomEvent("ready", { detail: { session_id: "s2s-test-123" } }),
  );
  expect(
    (ctx.s2sHandle.updateSession as ReturnType<typeof spy>).calls.length,
  ).toBeGreaterThan(0);
  const updateCall =
    (ctx.s2sHandle.updateSession as ReturnType<typeof spy>).calls[0];
  const config = updateCall.args[0] as Record<string, unknown>;
  expect(config.system_prompt).toBeDefined();
  expect(typeof config.system_prompt).toBe("string");
  expect(config.tools).toBeDefined();
  expect(config.voice).toBe("luna");
});

Deno.test("system prompt includes greeting instruction", async () => {
  const ctx = setup();
  await ctx.session.start();
  ctx.s2sHandle.dispatchEvent(
    new CustomEvent("ready", { detail: { session_id: "s2s-test-123" } }),
  );
  const updateCall =
    (ctx.s2sHandle.updateSession as ReturnType<typeof spy>).calls[0];
  const config = updateCall.args[0] as Record<string, unknown>;
  expect(config.system_prompt as string).toContain("Hi there!");
});

Deno.test("onAudio forwards to S2S handle", async () => {
  const ctx = setup();
  await ctx.session.start();
  ctx.session.onAudio(new Uint8Array([1, 2, 3]));
  expect(
    (ctx.s2sHandle.sendAudio as ReturnType<typeof spy>).calls.length,
  ).toBe(1);
});

Deno.test("reply.audio relays decoded audio to transport", async () => {
  const ctx = setup();
  await ctx.session.start();
  const audioData = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
  ctx.s2sHandle.dispatchEvent(
    new CustomEvent("audio", {
      detail: { reply_id: "r1", audio: audioData },
    }),
  );
  const binary = getSentBinary(ctx.transport);
  expect(binary.length).toBeGreaterThan(0);
  expect(binary[0]).toEqual(audioData);
});

Deno.test("user_transcript forwards as final_transcript", async () => {
  const ctx = setup();
  await ctx.session.start();
  ctx.s2sHandle.dispatchEvent(
    new CustomEvent("user_transcript", {
      detail: { item_id: "i1", text: "Hello world" },
    }),
  );
  const msgs = getSentJson(ctx.transport);
  const transcript = msgs.find((m) => m.type === "final_transcript");
  expect(transcript).toBeDefined();
  expect(transcript!.text).toBe("Hello world");
});

Deno.test("agent_transcript forwards as chat message", async () => {
  const ctx = setup();
  await ctx.session.start();
  ctx.s2sHandle.dispatchEvent(
    new CustomEvent("agent_transcript", {
      detail: { reply_id: "r1", item_id: "i1", text: "Hi there!" },
    }),
  );
  const msgs = getSentJson(ctx.transport);
  const chat = msgs.find((m) => m.type === "chat");
  expect(chat).toBeDefined();
  expect(chat!.text).toBe("Hi there!");
});

Deno.test("reply.done sends tts_done on completed", async () => {
  const ctx = setup();
  await ctx.session.start();
  ctx.s2sHandle.dispatchEvent(
    new CustomEvent("reply_done", {
      detail: { reply_id: "r1", status: "completed" },
    }),
  );
  const msgs = getSentJson(ctx.transport);
  expect(msgs.find((m) => m.type === "tts_done")).toBeDefined();
});

Deno.test("reply.done sends cancelled on interrupted (barge-in)", async () => {
  const ctx = setup();
  await ctx.session.start();
  ctx.s2sHandle.dispatchEvent(
    new CustomEvent("reply_done", {
      detail: { reply_id: "r1", status: "interrupted" },
    }),
  );
  const msgs = getSentJson(ctx.transport);
  expect(msgs.find((m) => m.type === "cancelled")).toBeDefined();
});

Deno.test("tool.call executes custom tool and sends result back", async () => {
  const ctx = setup({
    agentConfig: { builtinTools: [] },
  });
  ctx.opts.toolSchemas = [{
    name: "my_tool",
    description: "A test tool",
    parameters: { type: "object", properties: {} },
  }];
  // Recreate session with updated opts
  const session = createSession(ctx.opts);
  await session.start();

  ctx.s2sHandle.dispatchEvent(
    new CustomEvent("reply_started", {
      detail: { reply_id: "r1" },
    }),
  );

  ctx.s2sHandle.dispatchEvent(
    new CustomEvent("tool_call", {
      detail: { call_id: "c1", name: "my_tool", args: "{}" },
    }),
  );

  // Wait for async tool execution
  await new Promise((r) => setTimeout(r, 50));

  expect(
    (ctx.s2sHandle.sendToolResult as ReturnType<typeof spy>).calls.length,
  ).toBe(1);
  const resultCall =
    (ctx.s2sHandle.sendToolResult as ReturnType<typeof spy>).calls[0];
  expect(resultCall.args[0]).toBe("c1");
});

Deno.test("stop closes S2S handle", async () => {
  const ctx = setup();
  await ctx.session.start();
  await ctx.session.stop();
  expect(
    (ctx.s2sHandle.close as ReturnType<typeof spy>).calls.length,
  ).toBe(1);
});

Deno.test("stop is idempotent", async () => {
  const ctx = setup();
  await ctx.session.start();
  await ctx.session.stop();
  await ctx.session.stop();
  expect(
    (ctx.s2sHandle.close as ReturnType<typeof spy>).calls.length,
  ).toBe(1);
});

Deno.test("trySendJson silently drops messages when WS is closed", () => {
  const mocks = createMockSessionOptions();
  mocks.opts.transport = {
    readyState: 3,
    send() {},
  } as unknown as SessionTransport;
  const session = createSession(mocks.opts);
  session.start();
  // Should not throw
});

Deno.test("S2S error event forwards to client", async () => {
  const ctx = setup();
  await ctx.session.start();
  ctx.s2sHandle.dispatchEvent(
    new CustomEvent("error", {
      detail: { code: "test_error", message: "Something went wrong" },
    }),
  );
  const msgs = getSentJson(ctx.transport);
  const err = msgs.find((m) => m.type === "error");
  expect(err).toBeDefined();
  expect(err!.message).toBe("Something went wrong");
});

Deno.test("session captures session_id from ready event", async () => {
  const ctx = setup();
  await ctx.session.start();
  ctx.s2sHandle.dispatchEvent(
    new CustomEvent("ready", {
      detail: { session_id: "abc-123" },
    }),
  );
  // session_id is stored internally — verified via reconnect test below
  expect(
    (ctx.s2sHandle.updateSession as ReturnType<typeof spy>).calls.length,
  ).toBeGreaterThan(0);
});

Deno.test("reconnect sends session.resume with stored session_id", async () => {
  let connectCount = 0;
  const handles: ReturnType<typeof createMockS2sHandle>[] = [];

  const mocks = createMockSessionOptions();
  mocks.opts.connectS2s = () => {
    const handle = createMockS2sHandle();
    handles.push(handle);
    connectCount++;
    return Promise.resolve(handle);
  };

  const session = createSession(mocks.opts);
  await session.start();

  // First connection — simulate ready with session_id
  const h1 = handles[0];
  h1.dispatchEvent(
    new CustomEvent("ready", { detail: { session_id: "resume-me" } }),
  );
  expect(connectCount).toBe(1);

  // Simulate S2S connection drop — triggers reconnect
  h1.dispatchEvent(new CustomEvent("close"));
  await new Promise((r) => setTimeout(r, 50));

  // Second connection should have called resumeSession
  expect(connectCount).toBe(2);
  const h2 = handles[1];
  expect(
    (h2.resumeSession as ReturnType<typeof spy>).calls.length,
  ).toBe(1);
  expect(
    (h2.resumeSession as ReturnType<typeof spy>).calls[0].args[0],
  ).toBe("resume-me");

  // Clean up — stop triggers abort so close handler won't reconnect again
  await session.stop();
});

Deno.test("reset clears session_id so reconnect starts fresh", async () => {
  let connectCount = 0;
  const handles: ReturnType<typeof createMockS2sHandle>[] = [];

  const mocks = createMockSessionOptions();
  mocks.opts.connectS2s = () => {
    const handle = createMockS2sHandle();
    handles.push(handle);
    connectCount++;
    return Promise.resolve(handle);
  };

  const session = createSession(mocks.opts);
  await session.start();

  // First connection — simulate ready with session_id
  handles[0].dispatchEvent(
    new CustomEvent("ready", { detail: { session_id: "old-session" } }),
  );

  // User resets — should clear session_id
  session.onReset();
  // Simulate the close event that S2S would fire (mock close doesn't auto-fire)
  handles[0].dispatchEvent(new CustomEvent("close"));
  await new Promise((r) => setTimeout(r, 50));

  // Reconnect after reset should NOT resume
  expect(connectCount).toBe(2);
  const h2 = handles[1];
  expect(
    (h2.resumeSession as ReturnType<typeof spy>).calls.length,
  ).toBe(0);

  await session.stop();
});

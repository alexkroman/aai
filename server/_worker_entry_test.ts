// Copyright 2025 the AAI authors. MIT license.
import {
  assert,
  assertEquals,
  assertNotStrictEquals,
  assertStrictEquals,
  assertStringIncludes,
} from "@std/assert";
import { z } from "zod";
import { createWorkerApi } from "./_worker_entry.ts";
import {
  executeToolCall,
  type HostApi,
  startWorker,
  TOOL_HANDLER_TIMEOUT,
} from "@aai/sdk/worker-entry";
import type { ToolDef } from "@aai/sdk/types";

function makeTool(
  execute: ToolDef["execute"],
  params?: ToolDef["parameters"],
): ToolDef {
  return { description: "test tool", parameters: params, execute };
}

function dummyHostApi(): HostApi {
  return {
    fetch() {
      return Promise.resolve({
        status: 200,
        statusText: "OK",
        headers: {},
        body: "",
      });
    },
    kv() {
      return Promise.resolve({ result: null });
    },
  };
}

function hostApi(overrides?: Partial<HostApi>): HostApi {
  return { ...dummyHostApi(), ...overrides };
}

Deno.test("executeToolCall", async (t) => {
  await t.step("calls execute and returns string result", async () => {
    const tool = makeTool(() => "hello");
    const result = await executeToolCall("greet", {}, { tool, env: {} });
    assertStrictEquals(result, "hello");
  });

  await t.step("returns JSON for non-string result", async () => {
    const tool = makeTool(() => ({ key: "value" }));
    const result = await executeToolCall("data", {}, { tool, env: {} });
    assertStrictEquals(result, '{"key":"value"}');
  });

  await t.step("returns 'null' for null result", async () => {
    const tool = makeTool(() => null);
    const result = await executeToolCall("noop", {}, { tool, env: {} });
    assertStrictEquals(result, "null");
  });

  await t.step("validates args against schema", async () => {
    const tool = makeTool(
      (args) => `Hello ${args.name}`,
      z.object({ name: z.string() }),
    );
    const result = await executeToolCall("greet", { name: 42 }, {
      tool,
      env: {},
    });
    assertStringIncludes(result, "Error: Invalid arguments");
    assertStringIncludes(result, "greet");
  });

  await t.step("passes valid args through schema", async () => {
    const tool = makeTool(
      (args) => `Hello ${args.name}`,
      z.object({ name: z.string() }),
    );
    const result = await executeToolCall("greet", { name: "world" }, {
      tool,
      env: {},
    });
    assertStrictEquals(result, "Hello world");
  });

  await t.step("catches execution errors", async () => {
    const tool = makeTool(() => {
      throw new Error("boom");
    });
    const result = await executeToolCall("fail", {}, { tool, env: {} });
    assertStrictEquals(result, "Error: boom");
  });

  await t.step("passes env and sessionId in context", async () => {
    let capturedCtx: unknown;
    const tool = makeTool((_args, ctx) => {
      capturedCtx = ctx;
      return "ok";
    });
    await executeToolCall("t", {}, {
      tool,
      env: { KEY: "val" },
      sessionId: "sess-1",
    });
    const ctx = capturedCtx as {
      env: Record<string, string>;
      sessionId: string;
    };
    assertEquals(ctx.env, { KEY: "val" });
    assertStrictEquals(ctx.sessionId, "sess-1");
  });

  await t.step("passes state in context", async () => {
    let capturedState: unknown;
    const tool = makeTool((_args, ctx) => {
      capturedState = ctx.state;
      return "ok";
    });
    const state = { count: 5 };
    await executeToolCall("t", {}, { tool, env: {}, state });
    assertEquals(capturedState, { count: 5 });
  });
});

Deno.test("TOOL_HANDLER_TIMEOUT", () => {
  assertStrictEquals(TOOL_HANDLER_TIMEOUT, 30_000);
});

Deno.test("startWorker via Comlink", async (t) => {
  await t.step("handles executeTool", async () => {
    const { port1, port2 } = new MessageChannel();
    startWorker(
      {
        name: "Test",
        mode: "full" as const,
        env: [],
        transport: ["websocket"],
        instructions: "",
        greeting: "",
        voice: "luna",
        maxSteps: 5,
        tools: {
          greet: {
            description: "Say hi",
            execute: () => "hello",
          },
        },
      },
      { env: { KEY: "val" }, endpoint: port1 },
    );

    const api = createWorkerApi(port2);
    const result = await api.executeTool("greet", {}, "s1", 5000);
    assertStrictEquals(result, "hello");
    await api.dispose?.();
    port1.close();
    port2.close();
  });

  await t.step("returns error for unknown tool", async () => {
    const { port1, port2 } = new MessageChannel();
    startWorker(
      {
        name: "Test",
        mode: "full" as const,
        env: [],
        transport: ["websocket"],
        instructions: "",
        greeting: "",
        voice: "luna",
        maxSteps: 5,
        tools: {},
      },
      { endpoint: port1 },
    );

    const api = createWorkerApi(port2);
    const result = await api.executeTool("missing", {}, undefined, 5000);
    assertStringIncludes(result, 'Unknown tool "missing"');
    await api.dispose?.();
    port1.close();
    port2.close();
  });

  await t.step("handles onConnect hook", async () => {
    const { port1, port2 } = new MessageChannel();
    let connected = false;
    startWorker(
      {
        name: "Test",
        mode: "full" as const,
        env: [],
        transport: ["websocket"],
        instructions: "",
        greeting: "",
        voice: "luna",
        maxSteps: 5,
        tools: {},
        onConnect: () => {
          connected = true;
        },
      },
      { endpoint: port1 },
    );

    const api = createWorkerApi(port2);
    await api.onConnect("s1", 5000);
    assertStrictEquals(connected, true);
    await api.dispose?.();
    port1.close();
    port2.close();
  });

  await t.step("initializes per-session state", async () => {
    const { port1, port2 } = new MessageChannel();
    let capturedState: unknown;
    startWorker(
      {
        name: "Test",
        mode: "full" as const,
        env: [],
        transport: ["websocket"],
        instructions: "",
        greeting: "",
        voice: "luna",
        maxSteps: 5,
        tools: {
          check: {
            description: "check state",
            execute: (_args, ctx) => {
              capturedState = ctx.state;
              return "ok";
            },
          },
        },
        state: () => ({ count: 0 }),
      },
      { endpoint: port1 },
    );

    const api = createWorkerApi(port2, dummyHostApi());
    await api.executeTool("check", {}, "s1", 5000);
    assertEquals(capturedState, { count: 0 });
    await api.dispose?.();
    port1.close();
    port2.close();
  });

  await t.step("cleans up session state on onDisconnect", async () => {
    const { port1, port2 } = new MessageChannel();
    const states: unknown[] = [];
    startWorker(
      {
        name: "Test",
        mode: "full" as const,
        env: [],
        transport: ["websocket"],
        instructions: "",
        greeting: "",
        voice: "luna",
        maxSteps: 5,
        tools: {
          check: {
            description: "check state",
            execute: (_args, ctx) => {
              states.push({ ...ctx.state as Record<string, unknown> });
              return "ok";
            },
          },
        },
        state: () => ({ count: 0 }),
        onDisconnect: () => {},
      },
      { endpoint: port1 },
    );

    const api = createWorkerApi(port2, dummyHostApi());

    // Create state for session
    await api.executeTool("check", {}, "s1", 5000);

    // Disconnect session
    await api.onDisconnect("s1", 5000);

    // New tool call should get fresh state
    await api.executeTool("check", {}, "s1", 5000);

    // Both should have count: 0 because state was re-created
    assertEquals(states, [{ count: 0 }, { count: 0 }]);
    await api.dispose?.();
    port1.close();
    port2.close();
  });
});

Deno.test("fetch proxy via Comlink", async (t) => {
  await t.step(
    "worker fetch proxies through host via Comlink",
    async () => {
      const { port1, port2 } = new MessageChannel();

      let capturedFetch: typeof globalThis.fetch | undefined;
      startWorker(
        {
          name: "Test",
          mode: "full" as const,
          env: [],
          transport: ["websocket"],
          instructions: "",
          greeting: "",
          voice: "luna",
          maxSteps: 5,
          tools: {
            do_fetch: {
              description: "fetch something",
              execute: async () => {
                capturedFetch = globalThis.fetch;
                const resp = await globalThis.fetch(
                  "https://api.example.com/data",
                );
                return await resp.text();
              },
            },
          },
        },
        { endpoint: port1 },
      );

      const api = createWorkerApi(
        port2,
        hostApi({
          fetch(req) {
            return Promise.resolve({
              status: 200,
              statusText: "OK",
              headers: { "content-type": "application/json" },
              body: `{"proxied":"${req.url}"}`,
            });
          },
        }),
      );

      const result = await api.executeTool("do_fetch", {}, "s1", 5000);
      assertStrictEquals(result, '{"proxied":"https://api.example.com/data"}');
      assert(capturedFetch !== undefined);
      assertNotStrictEquals(capturedFetch, undefined);
      await api.dispose?.();
      port1.close();
      port2.close();
    },
  );

  await t.step(
    "fetch proxy returns proper Response object",
    async () => {
      const { port1, port2 } = new MessageChannel();

      let capturedStatus: number | undefined;
      let capturedHeaders: string | undefined;

      startWorker(
        {
          name: "Test",
          mode: "full" as const,
          env: [],
          transport: ["websocket"],
          instructions: "",
          greeting: "",
          voice: "luna",
          maxSteps: 5,
          tools: {
            check_response: {
              description: "check response properties",
              execute: async () => {
                const resp = await globalThis.fetch(
                  "https://example.com",
                );
                capturedStatus = resp.status;
                capturedHeaders = resp.headers.get("x-custom") ?? undefined;
                return `${resp.status} ${resp.statusText}`;
              },
            },
          },
        },
        { endpoint: port1 },
      );

      const api = createWorkerApi(
        port2,
        hostApi({
          fetch() {
            return Promise.resolve({
              status: 201,
              statusText: "Created",
              headers: { "x-custom": "test-value" },
              body: "",
            });
          },
        }),
      );

      const result = await api.executeTool(
        "check_response",
        {},
        "s1",
        5000,
      );
      assertStrictEquals(result, "201 Created");
      assertStrictEquals(capturedStatus, 201);
      assertStrictEquals(capturedHeaders, "test-value");
      await api.dispose?.();
      port1.close();
      port2.close();
    },
  );

  await t.step(
    "fetch proxy propagates host errors",
    async () => {
      const { port1, port2 } = new MessageChannel();

      startWorker(
        {
          name: "Test",
          mode: "full" as const,
          env: [],
          transport: ["websocket"],
          instructions: "",
          greeting: "",
          voice: "luna",
          maxSteps: 5,
          tools: {
            bad_fetch: {
              description: "fetch blocked URL",
              execute: async () => {
                await globalThis.fetch("http://169.254.169.254/metadata");
                return "should not reach";
              },
            },
          },
        },
        { endpoint: port1 },
      );

      const api = createWorkerApi(
        port2,
        hostApi({
          fetch() {
            return Promise.reject(
              new Error(
                "Blocked request to private address: 169.254.169.254",
              ),
            );
          },
        }),
      );

      const result = await api.executeTool(
        "bad_fetch",
        {},
        "s1",
        5000,
      );
      assertStringIncludes(result, "Blocked request to private address");
      await api.dispose?.();
      port1.close();
      port2.close();
    },
  );

  await t.step(
    "fetch proxy sends method and headers",
    async () => {
      const { port1, port2 } = new MessageChannel();
      let capturedMethod: string | undefined;
      let capturedHeaders: Record<string, string> | undefined;
      let capturedBody: string | null | undefined;

      startWorker(
        {
          name: "Test",
          mode: "full" as const,
          env: [],
          transport: ["websocket"],
          instructions: "",
          greeting: "",
          voice: "luna",
          maxSteps: 5,
          tools: {
            post_data: {
              description: "POST some data",
              execute: async () => {
                const resp = await globalThis.fetch("https://api.example.com", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: '{"hello":"world"}',
                });
                return await resp.text();
              },
            },
          },
        },
        { endpoint: port1 },
      );

      const api = createWorkerApi(
        port2,
        hostApi({
          fetch(req) {
            capturedMethod = req.method;
            capturedHeaders = req.headers;
            capturedBody = req.body;
            return Promise.resolve({
              status: 200,
              statusText: "OK",
              headers: {},
              body: "posted",
            });
          },
        }),
      );

      const result = await api.executeTool(
        "post_data",
        {},
        "s1",
        5000,
      );
      assertStrictEquals(result, "posted");
      assertStrictEquals(capturedMethod, "POST");
      assertStrictEquals(capturedHeaders?.["content-type"], "application/json");
      assertStrictEquals(capturedBody, '{"hello":"world"}');
      await api.dispose?.();
      port1.close();
      port2.close();
    },
  );
});

Deno.test("createWorkerApi with hostApi", async (t) => {
  await t.step(
    "creates bidirectional communication when hostApi provided",
    async () => {
      const { port1, port2 } = new MessageChannel();
      let fetchCalled = false;
      startWorker(
        {
          name: "Test",
          mode: "full" as const,
          env: [],
          transport: ["websocket"],
          instructions: "",
          greeting: "",
          voice: "luna",
          maxSteps: 5,
          tools: {
            do_fetch: {
              description: "fetch",
              execute: async () => {
                const resp = await globalThis.fetch("https://example.com");
                return await resp.text();
              },
            },
          },
        },
        { endpoint: port1 },
      );

      const api = createWorkerApi(
        port2,
        hostApi({
          fetch() {
            fetchCalled = true;
            return Promise.resolve({
              status: 200,
              statusText: "OK",
              headers: {},
              body: "ok",
            });
          },
        }),
      );

      await api.executeTool("do_fetch", {}, "s1", 5000);
      assertStrictEquals(fetchCalled, true);
      await api.dispose?.();
      port1.close();
      port2.close();
    },
  );

  await t.step(
    "works without hostApi for tools that don't need fetch/kv",
    async () => {
      const { port1, port2 } = new MessageChannel();
      startWorker(
        {
          name: "Test",
          mode: "full" as const,
          env: [],
          transport: ["websocket"],
          instructions: "",
          greeting: "",
          voice: "luna",
          maxSteps: 5,
          tools: {
            greet: {
              description: "greet",
              execute: () => "hello",
            },
          },
        },
        { endpoint: port1 },
      );

      const api = createWorkerApi(port2);
      const result = await api.executeTool("greet", {}, "s1", 5000);
      assertStrictEquals(result, "hello");
      await api.dispose?.();
      port1.close();
      port2.close();
    },
  );
});

import { expect } from "@std/expect";
import { z } from "zod";
import {
  createWorkerApi,
  executeToolCall,
  startWorker,
  TOOL_HANDLER_TIMEOUT,
} from "./_worker_entry.ts";
import { type MessageTarget, serveRpc } from "./_rpc.ts";
import type { ToolDef } from "@aai/sdk/types";

function makeTool(
  execute: ToolDef["execute"],
  params?: ToolDef["parameters"],
): ToolDef {
  return { description: "test tool", parameters: params, execute };
}

Deno.test("executeToolCall", async (t) => {
  await t.step("calls execute and returns string result", async () => {
    const tool = makeTool(() => "hello");
    const result = await executeToolCall("greet", {}, tool, {});
    expect(result).toBe("hello");
  });

  await t.step("returns JSON for non-string result", async () => {
    const tool = makeTool(() => ({ key: "value" }));
    const result = await executeToolCall("data", {}, tool, {});
    expect(result).toBe('{"key":"value"}');
  });

  await t.step("returns 'null' for null result", async () => {
    const tool = makeTool(() => null);
    const result = await executeToolCall("noop", {}, tool, {});
    expect(result).toBe("null");
  });

  await t.step("validates args against schema", async () => {
    const tool = makeTool(
      (args) => `Hello ${args.name}`,
      z.object({ name: z.string() }),
    );
    const result = await executeToolCall("greet", { name: 42 }, tool, {});
    expect(result).toContain("Error: Invalid arguments");
    expect(result).toContain("greet");
  });

  await t.step("passes valid args through schema", async () => {
    const tool = makeTool(
      (args) => `Hello ${args.name}`,
      z.object({ name: z.string() }),
    );
    const result = await executeToolCall("greet", { name: "world" }, tool, {});
    expect(result).toBe("Hello world");
  });

  await t.step("catches execution errors", async () => {
    const tool = makeTool(() => {
      throw new Error("boom");
    });
    const result = await executeToolCall("fail", {}, tool, {});
    expect(result).toBe("Error: boom");
  });

  await t.step("passes env and sessionId in context", async () => {
    let capturedCtx: unknown;
    const tool = makeTool((_args, ctx) => {
      capturedCtx = ctx;
      return "ok";
    });
    await executeToolCall("t", {}, tool, { KEY: "val" }, "sess-1");
    const ctx = capturedCtx as {
      env: Record<string, string>;
      sessionId: string;
    };
    expect(ctx.env).toEqual({ KEY: "val" });
    expect(ctx.sessionId).toBe("sess-1");
  });

  await t.step("passes state in context", async () => {
    let capturedState: unknown;
    const tool = makeTool((_args, ctx) => {
      capturedState = ctx.state;
      return "ok";
    });
    const state = { count: 5 };
    await executeToolCall("t", {}, tool, {}, undefined, state);
    expect(capturedState).toEqual({ count: 5 });
  });
});

Deno.test("TOOL_HANDLER_TIMEOUT", () => {
  expect(TOOL_HANDLER_TIMEOUT).toBe(30_000);
});

Deno.test("startWorker", async (t) => {
  function createMockPort(): MessageTarget & { sent: unknown[] } {
    return {
      onmessage: null,
      sent: [] as unknown[],
      postMessage(message: unknown) {
        this.sent.push(message);
      },
    };
  }

  function dispatch(target: MessageTarget, data: unknown) {
    target.onmessage?.({ data } as MessageEvent);
  }

  await t.step("handles executeTool RPC", async () => {
    const port = createMockPort();
    startWorker(
      {
        name: "Test",
        env: [],
        transport: ["websocket"],
        instructions: "",
        greeting: "",
        voice: "luna",
        tools: {
          greet: {
            description: "Say hi",
            execute: () => "hello",
          },
        },
      },
      { KEY: "val" },
      port,
    );

    dispatch(port, {
      id: 1,
      type: "executeTool",
      name: "greet",
      args: {},
      sessionId: "s1",
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(port.sent).toEqual([{ id: 1, result: "hello" }]);
  });

  await t.step("returns error for unknown tool", async () => {
    const port = createMockPort();
    startWorker(
      {
        name: "Test",
        env: [],
        transport: ["websocket"],
        instructions: "",
        greeting: "",
        voice: "luna",
        tools: {},
      },
      {},
      port,
    );

    dispatch(port, {
      id: 2,
      type: "executeTool",
      name: "missing",
      args: {},
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(port.sent).toEqual([
      { id: 2, result: 'Error: Unknown tool "missing"' },
    ]);
  });

  await t.step("handles invokeHook for onConnect", async () => {
    const port = createMockPort();
    let connected = false;
    startWorker(
      {
        name: "Test",
        env: [],
        transport: ["websocket"],
        instructions: "",
        greeting: "",
        voice: "luna",
        tools: {},
        onConnect: () => {
          connected = true;
        },
      },
      {},
      port,
    );

    dispatch(port, {
      id: 3,
      type: "invokeHook",
      hook: "onConnect",
      sessionId: "s1",
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(connected).toBe(true);
  });

  await t.step("initializes per-session state", async () => {
    const port = createMockPort();
    let capturedState: unknown;
    startWorker(
      {
        name: "Test",
        env: [],
        transport: ["websocket"],
        instructions: "",
        greeting: "",
        voice: "luna",
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
      {},
      port,
    );

    dispatch(port, {
      id: 1,
      type: "executeTool",
      name: "check",
      args: {},
      sessionId: "s1",
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(capturedState).toEqual({ count: 0 });
  });

  await t.step("cleans up session state on onDisconnect", async () => {
    const port = createMockPort();
    const states: unknown[] = [];
    startWorker(
      {
        name: "Test",
        env: [],
        transport: ["websocket"],
        instructions: "",
        greeting: "",
        voice: "luna",
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
      {},
      port,
    );

    // Create state for session
    dispatch(port, {
      id: 1,
      type: "executeTool",
      name: "check",
      args: {},
      sessionId: "s1",
    });
    await new Promise((r) => setTimeout(r, 10));

    // Disconnect session
    dispatch(port, {
      id: 2,
      type: "invokeHook",
      hook: "onDisconnect",
      sessionId: "s1",
    });
    await new Promise((r) => setTimeout(r, 10));

    // New tool call should get fresh state
    dispatch(port, {
      id: 3,
      type: "executeTool",
      name: "check",
      args: {},
      sessionId: "s1",
    });
    await new Promise((r) => setTimeout(r, 10));

    // Both should have count: 0 because state was re-created
    expect(states).toEqual([{ count: 0 }, { count: 0 }]);
  });
});

Deno.test("fetch proxy via RPC", async (t) => {
  /**
   * Creates a linked pair of mock ports that forward messages to each other,
   * simulating a MessageChannel for unit tests.
   */
  function createLinkedPorts(): [
    MessageTarget & { sent: unknown[] },
    MessageTarget & { sent: unknown[] },
  ] {
    const portA: MessageTarget & { sent: unknown[] } = {
      onmessage: null,
      sent: [],
      postMessage(message: unknown) {
        this.sent.push(message);
        // Forward to portB's onmessage
        queueMicrotask(() =>
          portB.onmessage?.({ data: message } as MessageEvent)
        );
      },
    };
    const portB: MessageTarget & { sent: unknown[] } = {
      onmessage: null,
      sent: [],
      postMessage(message: unknown) {
        this.sent.push(message);
        // Forward to portA's onmessage
        queueMicrotask(() =>
          portA.onmessage?.({ data: message } as MessageEvent)
        );
      },
    };
    return [portA, portB];
  }

  await t.step(
    "worker fetch proxies through host via RPC",
    async () => {
      const [workerPort, hostPort] = createLinkedPorts();

      // Set up worker side (startWorker installs fetch proxy)
      let capturedFetch: typeof globalThis.fetch | undefined;
      startWorker(
        {
          name: "Test",
          env: [],
          transport: ["websocket"],
          instructions: "",
          greeting: "",
          voice: "luna",
          tools: {
            do_fetch: {
              description: "fetch something",
              execute: async () => {
                // Capture the monkeypatched fetch
                capturedFetch = globalThis.fetch;
                const resp = await globalThis.fetch(
                  "https://api.example.com/data",
                );
                return await resp.text();
              },
            },
          },
        },
        {},
        workerPort,
      );

      // Set up host side with fetch handler
      const api = createWorkerApi(hostPort, {
        async fetch(req) {
          // Simulate the host fetch handler
          return {
            status: 200,
            statusText: "OK",
            headers: { "content-type": "application/json" },
            body: `{"proxied":"${req.url}"}`,
          };
        },
      });

      // Call executeTool which internally calls fetch
      const result = await api.executeTool(
        "do_fetch",
        {},
        "s1",
        5000,
      );
      expect(result).toBe('{"proxied":"https://api.example.com/data"}');
      expect(capturedFetch).toBeDefined();
      // The monkeypatched fetch should NOT be the original
      expect(capturedFetch).not.toBe(undefined);
    },
  );

  await t.step(
    "fetch proxy returns proper Response object",
    async () => {
      const [workerPort, hostPort] = createLinkedPorts();

      let capturedStatus: number | undefined;
      let capturedHeaders: string | undefined;

      startWorker(
        {
          name: "Test",
          env: [],
          transport: ["websocket"],
          instructions: "",
          greeting: "",
          voice: "luna",
          tools: {
            check_response: {
              description: "check response properties",
              execute: async () => {
                const resp = await globalThis.fetch(
                  "https://example.com",
                );
                capturedStatus = resp.status;
                capturedHeaders = resp.headers.get("x-custom");
                return `${resp.status} ${resp.statusText}`;
              },
            },
          },
        },
        {},
        workerPort,
      );

      const api = createWorkerApi(hostPort, {
        async fetch() {
          return {
            status: 201,
            statusText: "Created",
            headers: { "x-custom": "test-value" },
            body: "",
          };
        },
      });

      const result = await api.executeTool(
        "check_response",
        {},
        "s1",
        5000,
      );
      expect(result).toBe("201 Created");
      expect(capturedStatus).toBe(201);
      expect(capturedHeaders).toBe("test-value");
    },
  );

  await t.step(
    "fetch proxy propagates host errors",
    async () => {
      const [workerPort, hostPort] = createLinkedPorts();

      startWorker(
        {
          name: "Test",
          env: [],
          transport: ["websocket"],
          instructions: "",
          greeting: "",
          voice: "luna",
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
        {},
        workerPort,
      );

      const api = createWorkerApi(hostPort, {
        fetch() {
          throw new Error("Blocked request to private address: 169.254.169.254");
        },
      });

      const result = await api.executeTool(
        "bad_fetch",
        {},
        "s1",
        5000,
      );
      expect(result).toContain("Blocked request to private address");
    },
  );

  await t.step(
    "fetch proxy sends method and headers",
    async () => {
      const [workerPort, hostPort] = createLinkedPorts();
      let capturedMethod: string | undefined;
      let capturedHeaders: Record<string, string> | undefined;
      let capturedBody: string | null | undefined;

      startWorker(
        {
          name: "Test",
          env: [],
          transport: ["websocket"],
          instructions: "",
          greeting: "",
          voice: "luna",
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
        {},
        workerPort,
      );

      const api = createWorkerApi(hostPort, {
        async fetch(req) {
          capturedMethod = req.method;
          capturedHeaders = req.headers;
          capturedBody = req.body;
          return {
            status: 200,
            statusText: "OK",
            headers: {},
            body: "posted",
          };
        },
      });

      const result = await api.executeTool(
        "post_data",
        {},
        "s1",
        5000,
      );
      expect(result).toBe("posted");
      expect(capturedMethod).toBe("POST");
      expect(capturedHeaders?.["content-type"]).toBe("application/json");
      expect(capturedBody).toBe('{"hello":"world"}');
    },
  );
});

Deno.test("createWorkerApi with hostHandlers", async (t) => {
  await t.step(
    "creates bidirectional RPC when hostHandlers provided",
    async () => {
      function createMockPort(): MessageTarget & { sent: unknown[] } {
        return {
          onmessage: null,
          sent: [] as unknown[],
          postMessage(message: unknown) {
            this.sent.push(message);
          },
        };
      }

      const port = createMockPort();
      let fetchCalled = false;
      const api = createWorkerApi(port, {
        fetch() {
          fetchCalled = true;
          return { status: 200, statusText: "OK", headers: {}, body: "" };
        },
      });

      // Should still function as a caller for executeTool
      const promise = api.executeTool("greet", {}, "s1", 5000);
      expect(port.sent.length).toBe(1);

      // Simulate incoming fetch request (host should serve it)
      port.onmessage?.({
        data: {
          id: 100,
          type: "fetch",
          url: "https://example.com",
          method: "GET",
          headers: {},
          body: null,
        },
      } as MessageEvent);
      await new Promise((r) => setTimeout(r, 10));
      expect(fetchCalled).toBe(true);

      // Resolve the outgoing call
      port.onmessage?.({
        data: { id: 0, result: "tool-result" },
      } as MessageEvent);
      expect(await promise).toBe("tool-result");
    },
  );

  await t.step(
    "uses unidirectional caller when no hostHandlers",
    () => {
      function createMockPort(): MessageTarget & { sent: unknown[] } {
        return {
          onmessage: null,
          sent: [] as unknown[],
          postMessage(message: unknown) {
            this.sent.push(message);
          },
        };
      }

      const port = createMockPort();
      const api = createWorkerApi(port);

      // Should still function as a caller
      api.executeTool("greet", {}, "s1", 5000);
      expect(port.sent.length).toBe(1);
    },
  );
});

import { expect } from "@std/expect";
import {
  createRpcCaller,
  createRpcEndpoint,
  type MessageTarget,
  serveRpc,
} from "./_rpc.ts";

function createMockTarget(): MessageTarget & { sent: unknown[] } {
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

Deno.test("serveRpc", async (t) => {
  await t.step("responds with result on success", async () => {
    const port = createMockTarget();
    serveRpc(port, {
      executeTool: () => "tool-result",
    });

    dispatch(port, {
      id: 1,
      type: "executeTool",
      name: "greet",
      args: {},
    });
    // Allow async handler to complete
    await new Promise((r) => setTimeout(r, 10));
    expect(port.sent).toEqual([{ id: 1, result: "tool-result" }]);
  });

  await t.step("responds with error for unknown method", async () => {
    const port = createMockTarget();
    serveRpc(port, {});

    dispatch(port, {
      id: 2,
      type: "executeTool",
      name: "greet",
      args: {},
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(port.sent).toEqual([
      { id: 2, error: 'Unknown RPC method "executeTool"' },
    ]);
  });

  await t.step("responds with error when handler throws", async () => {
    const port = createMockTarget();
    serveRpc(port, {
      executeTool: () => {
        throw new Error("boom");
      },
    });

    dispatch(port, {
      id: 3,
      type: "executeTool",
      name: "greet",
      args: {},
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(port.sent).toEqual([{ id: 3, error: "boom" }]);
  });

  await t.step("sends error for invalid request with id", async () => {
    const port = createMockTarget();
    serveRpc(port, {});

    dispatch(port, { id: 5, badField: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(port.sent).toEqual([{ id: 5, error: "Invalid RPC request" }]);
  });

  await t.step("ignores invalid request without id", async () => {
    const port = createMockTarget();
    serveRpc(port, {});

    dispatch(port, { badField: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(port.sent).toEqual([]);
  });
});

Deno.test("createRpcCaller", async (t) => {
  await t.step("sends request and resolves on response", async () => {
    const port = createMockTarget();
    const call = createRpcCaller(port);

    const promise = call("executeTool", { name: "greet", args: {} });
    // Simulate response
    dispatch(port, { id: 0, result: "hello" });
    const result = await promise;
    expect(result).toBe("hello");
    expect(port.sent[0]).toEqual({
      id: 0,
      type: "executeTool",
      name: "greet",
      args: {},
    });
  });

  await t.step("rejects on error response", async () => {
    const port = createMockTarget();
    const call = createRpcCaller(port);

    const promise = call("executeTool", { name: "greet", args: {} });
    dispatch(port, { id: 0, error: "not found" });
    await expect(promise).rejects.toThrow("not found");
  });

  await t.step("increments ids", async () => {
    const port = createMockTarget();
    const call = createRpcCaller(port);

    const p1 = call("executeTool", { name: "a", args: {} });
    const p2 = call("executeTool", { name: "b", args: {} });

    dispatch(port, { id: 0, result: "r1" });
    dispatch(port, { id: 1, result: "r2" });

    expect(await p1).toBe("r1");
    expect(await p2).toBe("r2");
    expect((port.sent[0] as { id: number }).id).toBe(0);
    expect((port.sent[1] as { id: number }).id).toBe(1);
  });

  await t.step("ignores responses for unknown ids", () => {
    const port = createMockTarget();
    createRpcCaller(port);
    // Should not throw
    dispatch(port, { id: 999, result: "orphan" });
  });
});

Deno.test("createRpcEndpoint", async (t) => {
  await t.step("serves incoming requests", async () => {
    const port = createMockTarget();
    createRpcEndpoint(port, {
      executeTool: () => "tool-result",
    });

    dispatch(port, {
      id: 1,
      type: "executeTool",
      name: "greet",
      args: {},
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(port.sent).toEqual([{ id: 1, result: "tool-result" }]);
  });

  await t.step("makes outgoing calls and resolves responses", async () => {
    const port = createMockTarget();
    const call = createRpcEndpoint(port, {});

    const promise = call("fetch", { url: "https://example.com" });
    // Simulate response (no `type` field)
    dispatch(port, { id: 0, result: { status: 200, body: "ok" } });
    const result = await promise;
    expect(result).toEqual({ status: 200, body: "ok" });
    expect(port.sent[0]).toEqual({
      id: 0,
      type: "fetch",
      url: "https://example.com",
    });
  });

  await t.step("handles bidirectional traffic on same port", async () => {
    const port = createMockTarget();
    const call = createRpcEndpoint(port, {
      executeTool: () => "served",
    });

    // Make an outgoing call
    const outgoing = call("fetch", { url: "https://example.com" });

    // Receive an incoming request while outgoing is pending
    dispatch(port, {
      id: 99,
      type: "executeTool",
      name: "greet",
      args: {},
    });
    await new Promise((r) => setTimeout(r, 10));

    // Incoming request should be served
    expect(port.sent).toContainEqual({ id: 99, result: "served" });

    // Resolve the outgoing call
    dispatch(port, { id: 0, result: "fetched" });
    expect(await outgoing).toBe("fetched");
  });

  await t.step("rejects outgoing call on error response", async () => {
    const port = createMockTarget();
    const call = createRpcEndpoint(port, {});

    const promise = call("fetch", { url: "https://example.com" });
    dispatch(port, { id: 0, error: "SSRF blocked" });
    await expect(promise).rejects.toThrow("SSRF blocked");
  });

  await t.step("returns error for unknown method", async () => {
    const port = createMockTarget();
    createRpcEndpoint(port, {});

    dispatch(port, {
      id: 5,
      type: "executeTool",
      name: "greet",
      args: {},
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(port.sent).toEqual([
      { id: 5, error: 'Unknown RPC method "executeTool"' },
    ]);
  });

  await t.step("returns error when handler throws", async () => {
    const port = createMockTarget();
    createRpcEndpoint(port, {
      executeTool: () => {
        throw new Error("boom");
      },
    });

    dispatch(port, {
      id: 6,
      type: "executeTool",
      name: "greet",
      args: {},
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(port.sent).toEqual([{ id: 6, error: "boom" }]);
  });

  await t.step("sends error for invalid request with id", async () => {
    const port = createMockTarget();
    createRpcEndpoint(port, {});

    dispatch(port, { id: 7, type: "badType", badField: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(port.sent).toEqual([{ id: 7, error: "Invalid RPC request" }]);
  });

  await t.step("ignores responses for unknown ids", () => {
    const port = createMockTarget();
    createRpcEndpoint(port, {});
    // Should not throw
    dispatch(port, { id: 999, result: "orphan" });
  });

  await t.step("increments outgoing call ids", async () => {
    const port = createMockTarget();
    const call = createRpcEndpoint(port, {});

    const p1 = call("fetch", { url: "a" });
    const p2 = call("fetch", { url: "b" });

    dispatch(port, { id: 0, result: "r1" });
    dispatch(port, { id: 1, result: "r2" });

    expect(await p1).toBe("r1");
    expect(await p2).toBe("r2");
    expect((port.sent[0] as { id: number }).id).toBe(0);
    expect((port.sent[1] as { id: number }).id).toBe(1);
  });
});

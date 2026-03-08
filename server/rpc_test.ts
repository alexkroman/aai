import { expect } from "@std/expect";
import { createSandboxRpc, createWorkerRpc } from "./rpc.ts";

Deno.test("createWorkerRpc", async (t) => {
  await t.step("executeTool sends RPC and returns string", async () => {
    const { port1, port2 } = new MessageChannel();

    // Simulate worker responding to RPC
    port2.onmessage = (e) => {
      const { id } = e.data;
      port2.postMessage({ id, result: "tool-result" });
    };

    const api = createWorkerRpc(port1);
    const result = await api.executeTool("test", { arg: 1 }, "sess-1", 5000);
    expect(result).toBe("tool-result");

    port1.close();
    port2.close();
  });

  await t.step("executeTool coerces non-string result to string", async () => {
    const { port1, port2 } = new MessageChannel();

    port2.onmessage = (e) => {
      const { id } = e.data;
      port2.postMessage({ id, result: 42 });
    };

    const api = createWorkerRpc(port1);
    const result = await api.executeTool("test", {});
    expect(result).toBe("42");

    port1.close();
    port2.close();
  });

  await t.step("invokeHook sends RPC and resolves", async () => {
    const { port1, port2 } = new MessageChannel();

    port2.onmessage = (e) => {
      const { id } = e.data;
      port2.postMessage({ id, result: undefined });
    };

    const api = createWorkerRpc(port1);
    await api.invokeHook("onConnect", "sess-1");

    port1.close();
    port2.close();
  });
});

Deno.test("createSandboxRpc", async (t) => {
  await t.step("execute sends code and returns result", async () => {
    const { port1, port2 } = new MessageChannel();

    port2.onmessage = (e) => {
      const { id } = e.data;
      port2.postMessage({ id, result: { output: "hello", error: undefined } });
    };

    const api = createSandboxRpc(port1);
    const result = await api.execute("console.log('hello')", 5000);
    expect(result.output).toBe("hello");
    expect(result.error).toBeUndefined();

    port1.close();
    port2.close();
  });
});

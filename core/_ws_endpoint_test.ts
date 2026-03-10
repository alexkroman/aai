import { expect } from "@std/expect";
import * as Comlink from "comlink";
import { createWebSocketEndpoint } from "./_ws_endpoint.ts";

/** Minimal mock WebSocket for testing. */
class MockWS extends EventTarget {
  readyState = 1; // OPEN
  sent: string[] = [];
  send(data: string) {
    this.sent.push(data);
  }
  simulateMessage(data: string) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

type TestApi = {
  add(a: number, b: number): number;
  greet(name: string): string;
};

Deno.test("WebSocket Comlink endpoint", async (t) => {
  await t.step("expose + wrap roundtrip", async () => {
    const serverWs = new MockWS();
    const clientWs = new MockWS();

    // Wire them together
    serverWs.send = (data: string) => clientWs.simulateMessage(data);
    clientWs.send = (data: string) => serverWs.simulateMessage(data);

    const serverEndpoint = createWebSocketEndpoint(
      serverWs as unknown as WebSocket,
    );
    const clientEndpoint = createWebSocketEndpoint(
      clientWs as unknown as WebSocket,
    );

    const api: TestApi = {
      add: (a, b) => a + b,
      greet: (name) => `Hello ${name}`,
    };

    Comlink.expose(api, serverEndpoint);
    const proxy = Comlink.wrap<TestApi>(clientEndpoint);

    expect(await proxy.add(2, 3)).toBe(5);
    expect(await proxy.greet("world")).toBe("Hello world");

    proxy[Comlink.releaseProxy]();
  });

  await t.step("ignores non-JSON messages", () => {
    const ws = new MockWS();
    const endpoint = createWebSocketEndpoint(ws as unknown as WebSocket);
    let dispatched = false;
    endpoint.addEventListener("message", () => {
      dispatched = true;
    });

    // Binary message
    ws.dispatchEvent(
      new MessageEvent("message", { data: new ArrayBuffer(8) }),
    );
    expect(dispatched).toBe(false);

    // Invalid JSON
    ws.dispatchEvent(new MessageEvent("message", { data: "not-json{" }));
    expect(dispatched).toBe(false);
  });

  await t.step("removeEventListener stops delivery", () => {
    const ws = new MockWS();
    const endpoint = createWebSocketEndpoint(ws as unknown as WebSocket);
    let count = 0;
    const listener = () => {
      count++;
    };

    endpoint.addEventListener("message", listener);
    ws.simulateMessage(JSON.stringify({ test: 1 }));
    expect(count).toBe(1);

    endpoint.removeEventListener("message", listener);
    ws.simulateMessage(JSON.stringify({ test: 2 }));
    expect(count).toBe(1);
  });

  await t.step("postMessage is no-op when WebSocket is closed", () => {
    const ws = new MockWS();
    ws.readyState = 3; // CLOSED
    const endpoint = createWebSocketEndpoint(ws as unknown as WebSocket);
    endpoint.postMessage({ test: true });
    expect(ws.sent.length).toBe(0);
  });
});

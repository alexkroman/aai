/**
 * Comlink Endpoint adapter backed by a WebSocket with JSON serialization.
 *
 * Use after any handshake protocol completes — all subsequent messages on the
 * WebSocket are treated as Comlink wire-format messages. Transferables are not
 * supported (not needed for the dev WebSocket path).
 */

import type { Endpoint } from "comlink";

export function createWebSocketEndpoint(ws: WebSocket): Endpoint {
  type Listener = EventListenerOrEventListenerObject;
  const listeners = new Set<Listener>();

  ws.addEventListener("message", (event: MessageEvent) => {
    if (typeof event.data !== "string") return;
    let data: unknown;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    const fakeEvent = new MessageEvent("message", { data });
    for (const listener of listeners) {
      if (typeof listener === "function") {
        listener(fakeEvent);
      } else {
        listener.handleEvent(fakeEvent);
      }
    }
  });

  return {
    postMessage(message: unknown) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    },
    addEventListener(_type: string, listener: Listener) {
      listeners.add(listener);
    },
    removeEventListener(_type: string, listener: Listener) {
      listeners.delete(listener);
    },
  };
}

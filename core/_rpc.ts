// Shared postMessage RPC helpers used by both worker and host sides.

import { RpcResponseSchema } from "./_rpc_schema.ts";

export type MessageTarget = {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
};

type Handler = (
  params: Record<string, unknown>,
) => Promise<unknown> | unknown;

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
};

export function serveRpc(
  port: MessageTarget,
  methods: Record<string, Handler>,
): void {
  port.onmessage = async (e: MessageEvent) => {
    const { id, type, ...params } = e.data;
    const fn = methods[type];
    if (!fn) {
      port.postMessage({ id, error: `Unknown method: ${type}` });
      return;
    }
    try {
      const result = await fn(params);
      port.postMessage({ id, result });
    } catch (err: unknown) {
      port.postMessage({
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
}

export function createWebSocketTarget(ws: WebSocket): MessageTarget {
  const target: MessageTarget = {
    onmessage: null,
    postMessage(message: unknown) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    },
  };

  ws.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    try {
      const data = JSON.parse(event.data);
      // Only forward RPC messages (have numeric id field)
      if (typeof data.id === "number") {
        target.onmessage?.({ data } as MessageEvent);
      }
    } catch { /* ignore non-JSON */ }
  });

  return target;
}

export type RpcCall = (
  type: string,
  payload?: Record<string, unknown>,
  timeoutMs?: number,
) => Promise<unknown>;

export function createRpcCaller(port: MessageTarget): RpcCall {
  let nextId = 0;
  const pending = new Map<number, PendingCall>();

  function settle(id: number, fn: (p: PendingCall) => void) {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (p.timer) clearTimeout(p.timer);
    fn(p);
  }

  port.onmessage = (e: MessageEvent) => {
    const parsed = RpcResponseSchema.safeParse(e.data);
    if (!parsed.success) return;
    const msg = parsed.data;
    settle(msg.id, (p) => {
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg.result);
    });
  };

  return (
    type: string,
    payload?: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<unknown> => {
    const id = nextId++;
    port.postMessage({ id, type, ...payload });
    return new Promise((resolve, reject) => {
      const entry: PendingCall = { resolve, reject };
      pending.set(id, entry);
      if (timeoutMs) {
        entry.timer = setTimeout(
          () =>
            settle(id, (p) =>
              p.reject(
                new Error(`RPC "${type}" timed out after ${timeoutMs}ms`),
              )),
          timeoutMs,
        );
      }
    });
  };
}

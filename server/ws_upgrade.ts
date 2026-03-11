import type { Context } from "hono";
import type { HonoEnv } from "./hono_env.ts";

/**
 * Minimal sender interface for WebSocket event handlers.
 * Compatible with both raw WebSocket and Hono's WSContext.
 */
export type WSSender = {
  send(data: string | ArrayBuffer | Uint8Array): void;
  readonly readyState: number;
};

/** Hono-style WebSocket event handlers. */
export type WSEvents = {
  onOpen?(evt: Event, ws: WSSender): void;
  onMessage?(evt: MessageEvent, ws: WSSender): void;
  onClose?(evt: CloseEvent, ws: WSSender): void | Promise<void>;
  onError?(evt: Event, ws: WSSender): void;
};

export const _internals = {
  upgradeWebSocket: (req: Request) => Deno.upgradeWebSocket(req),
};

/**
 * Hono-style upgradeWebSocket helper with a stubbable upgrade function.
 * Takes a factory that returns WSEvents, upgrades the connection, and
 * attaches event listeners to the socket.
 */
export function upgradeWebSocket(
  factory: (c: Context<HonoEnv>) => WSEvents | Promise<WSEvents>,
): (c: Context<HonoEnv>) => Promise<Response> {
  return async (c) => {
    const events = await factory(c);
    const { socket, response } = _internals.upgradeWebSocket(c.req.raw);

    if (events.onOpen) {
      socket.addEventListener("open", (e) => events.onOpen!(e, socket));
    }
    if (events.onMessage) {
      socket.addEventListener("message", (e) => events.onMessage!(e, socket));
    }
    if (events.onClose) {
      socket.addEventListener(
        "close",
        (e) => void events.onClose!(e, socket),
      );
    }
    if (events.onError) {
      socket.addEventListener("error", (e) => events.onError!(e, socket));
    }

    return response;
  };
}

// Copyright 2025 the AAI authors. MIT license.
import * as log from "@std/log";
import { ClientMessageSchema } from "./_schemas.ts";
import type { Session, SessionTransport } from "./session.ts";
import type { WSContext, WSEvents } from "hono/ws";

/** Options for creating WebSocket session event handlers. */
export type WsSessionOptions = {
  /** Factory function to create a session for a given ID and transport. */
  createSession: (sessionId: string, transport: SessionTransport) => Session;
  /** Additional key-value pairs included in log messages. */
  logContext?: Record<string, string>;
  /** Callback invoked when the WebSocket connection opens. */
  onOpen?: () => void;
  /** Callback invoked when the WebSocket connection closes. */
  onClose?: () => void;
};

/**
 * Creates Hono-style WSEvents that manage a session lifecycle.
 * The returned handlers can be used with upgradeWebSocket().
 */
export function createSessionWSEvents(
  sessions: Map<string, Session>,
  opts: WsSessionOptions,
): WSEvents {
  const sessionId = crypto.randomUUID();
  const sid = sessionId.slice(0, 8);
  const ctx = opts.logContext ?? {};

  let session: Session | null = null;
  let ready = false;
  const pendingMessages: string[] = [];
  let processingChain: Promise<void> = Promise.resolve();

  function processControlMessage(raw: string, ws: WSContext): void {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return;
    }
    const parsed = ClientMessageSchema.safeParse(json);
    if (!parsed.success) return;

    if (parsed.data.type === "ping") {
      ws.send(JSON.stringify({ type: "pong" }));
    } else if (parsed.data.type === "audio_ready") {
      session?.onAudioReady();
    } else if (parsed.data.type === "cancel") {
      session?.onCancel();
    } else if (parsed.data.type === "reset") {
      session?.onReset();
    } else if (parsed.data.type === "history") {
      session?.onHistory(parsed.data.messages);
    }
  }

  function enqueueControl(raw: string, ws: WSContext): void {
    processingChain = processingChain
      .then(() => processControlMessage(raw, ws))
      .catch((err) => {
        log.error("Control message processing error", {
          ...ctx,
          sid,
          error: err,
        });
      });
  }

  return {
    onOpen(_evt, ws) {
      opts.onOpen?.();
      log.info("Session connected", { ...ctx, sid });

      session = opts.createSession(sessionId, ws);
      sessions.set(sessionId, session);

      log.info("Session configured", { ...ctx, sid });
      void session.start();

      for (const msg of pendingMessages) {
        enqueueControl(msg, ws);
      }
      pendingMessages.length = 0;
      processingChain = processingChain.then(() => {
        ready = true;
      });
    },

    onMessage(event, ws) {
      const isBinary = event.data instanceof ArrayBuffer;

      if (!isBinary && (event.data as string).length > 1_000_000) return;

      if (!ready) {
        if (!isBinary) {
          let json: unknown;
          try {
            json = JSON.parse(event.data as string);
          } catch { /* not JSON */ }
          if (
            json !== null && typeof json === "object" &&
            (json as Record<string, unknown>).type === "ping"
          ) {
            ws.send(JSON.stringify({ type: "pong" }));
            return;
          }
          pendingMessages.push(event.data as string);
        }
        return;
      }

      if (isBinary) {
        session?.onAudio(new Uint8Array(event.data));
        return;
      }

      enqueueControl(event.data as string, ws);
    },

    async onClose() {
      log.info("Session disconnected", { ...ctx, sid });
      if (session) {
        await session.stop();
        sessions.delete(sessionId);
      }
      opts.onClose?.();
    },

    onError(event) {
      const msg = event instanceof ErrorEvent
        ? event.message
        : "WebSocket error";
      log.error("WebSocket error", { ...ctx, sid, error: msg });
    },
  };
}

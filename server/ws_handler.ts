// Copyright 2025 the AAI authors. MIT license.
import * as log from "@std/log";
import { ClientMessageSchema } from "./_schemas.ts";
import type { Session, SessionTransport } from "./session.ts";

/** Options for wiring a WebSocket to a session. */
export type WsSessionOptions = {
  /** Map of active sessions (session is added on open, removed on close). */
  sessions: Map<string, Session>;
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
 * Attaches session lifecycle handlers to a native WebSocket.
 *
 * Manages the full session lifecycle: creates the session on open,
 * dispatches audio and control messages, and cleans up on close.
 */
export function wireSessionSocket(
  ws: WebSocket,
  opts: WsSessionOptions,
): void {
  const { sessions } = opts;
  const sessionId = crypto.randomUUID();
  const sid = sessionId.slice(0, 8);
  const ctx = opts.logContext ?? {};

  let session: Session | null = null;
  let ready = false;
  const pendingMessages: string[] = [];
  let processingChain: Promise<void> = Promise.resolve();

  function processControlMessage(raw: string): void {
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

  function enqueueControl(raw: string): void {
    processingChain = processingChain
      .then(() => processControlMessage(raw))
      .catch((err) => {
        log.error("Control message processing error", {
          ...ctx,
          sid,
          error: err,
        });
      });
  }

  ws.addEventListener("open", () => {
    opts.onOpen?.();
    log.info("Session connected", { ...ctx, sid });

    const transport: SessionTransport = {
      get readyState() {
        return ws.readyState as 0 | 1 | 2 | 3;
      },
      send(data: string | ArrayBuffer | Uint8Array) {
        ws.send(data);
      },
    };
    session = opts.createSession(sessionId, transport);
    sessions.set(sessionId, session);

    log.info("Session configured", { ...ctx, sid });
    void session.start();

    for (const msg of pendingMessages) {
      enqueueControl(msg);
    }
    pendingMessages.length = 0;
    processingChain = processingChain.then(() => {
      ready = true;
    });
  });

  ws.addEventListener("message", (event: Event) => {
    const msgEvent = event as MessageEvent;
    const isBinary = msgEvent.data instanceof ArrayBuffer;

    if (!isBinary && (msgEvent.data as string).length > 1_000_000) return;

    if (!ready) {
      if (!isBinary) {
        let json: unknown;
        try {
          json = JSON.parse(msgEvent.data as string);
        } catch { /* not JSON */ }
        if (
          json !== null && typeof json === "object" &&
          (json as Record<string, unknown>).type === "ping"
        ) {
          ws.send(JSON.stringify({ type: "pong" }));
          return;
        }
        pendingMessages.push(msgEvent.data as string);
      }
      return;
    }

    if (isBinary) {
      session?.onAudio(new Uint8Array(msgEvent.data));
      return;
    }

    enqueueControl(msgEvent.data as string);
  });

  ws.addEventListener("close", () => {
    log.info("Session disconnected", { ...ctx, sid });
    if (session) {
      void session.stop().then(() => {
        sessions.delete(sessionId);
      });
    }
    opts.onClose?.();
  });

  ws.addEventListener("error", (event) => {
    const msg = event instanceof ErrorEvent ? event.message : "WebSocket error";
    log.error("WebSocket error", { ...ctx, sid, error: msg });
  });
}

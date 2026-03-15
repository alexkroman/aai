// Copyright 2025 the AAI authors. MIT license.
import * as log from "@std/log";
import type { Session } from "./session.ts";
import type { ClientMessage, ClientSink, ReadyConfig } from "@aai/sdk/protocol";
import { ClientMessageSchema } from "@aai/sdk/protocol";
import { isValidAudioChunk } from "./_schemas.ts";

/** Options for wiring a WebSocket to a session. */
export type WsSessionOptions = {
  /** Map of active sessions (session is added on open, removed on close). */
  sessions: Map<string, Session>;
  /** Factory function to create a session for a given ID and client sink. */
  createSession: (sessionId: string, client: ClientSink) => Session;
  /** Protocol config sent to the client immediately on connect. */
  readyConfig: ReadyConfig;
  /** Additional key-value pairs included in log messages. */
  logContext?: Record<string, string>;
  /** Callback invoked when the WebSocket connection opens. */
  onOpen?: () => void;
  /** Callback invoked when the WebSocket connection closes. */
  onClose?: () => void;
};

/**
 * Creates a {@linkcode ClientSink} backed by a plain WebSocket.
 *
 * Text events are sent as JSON text frames; audio chunks are sent as
 * binary frames (zero-copy).
 */
function createClientSink(ws: WebSocket): ClientSink {
  return {
    get open() {
      return ws.readyState === WebSocket.OPEN;
    },
    event(e) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(e));
      }
    },
    playAudioChunk(chunk) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(chunk);
      }
    },
    playAudioDone() {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "audio_done" }));
      }
    },
  };
}

/**
 * Attaches session lifecycle handlers to a native WebSocket using
 * plain JSON text frames and binary audio frames.
 *
 * Connection flow:
 * 1. WebSocket opens → server sends `{ type: "config", ...ReadyConfig }`
 * 2. Client sets up audio → sends `{ type: "audio_ready" }`
 * 3. If reconnecting → client sends `{ type: "history", messages: [...] }`
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

  ws.addEventListener("open", () => {
    opts.onOpen?.();
    log.info("Session connected", { ...ctx, sid });

    const client = createClientSink(ws);
    session = opts.createSession(sessionId, client);
    sessions.set(sessionId, session);

    // Send config immediately — zero RTT
    ws.send(JSON.stringify({ type: "config", ...opts.readyConfig }));

    void session.start();
    log.info("Session ready", { ...ctx, sid });
  });

  ws.addEventListener("message", (event: Event) => {
    if (!session) return;
    const msgEvent = event as MessageEvent;
    const { data } = msgEvent;

    // Binary frame → raw PCM16 audio
    if (data instanceof ArrayBuffer) {
      const chunk = new Uint8Array(data);
      if (!isValidAudioChunk(chunk)) {
        log.warn("Invalid audio chunk, dropping", {
          ...ctx,
          sid,
          bytes: chunk.byteLength,
          aligned: chunk.byteLength % 2 === 0,
        });
        return;
      }
      session.onAudio(chunk);
      return;
    }

    // Text frame → JSON message
    if (typeof data !== "string") return;
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      log.warn("Invalid JSON from client", { ...ctx, sid });
      return;
    }

    const parsed = ClientMessageSchema.safeParse(json);
    if (!parsed.success) {
      log.warn("Invalid client message", {
        ...ctx,
        sid,
        error: parsed.error.message,
      });
      return;
    }

    const msg: ClientMessage = parsed.data;
    switch (msg.type) {
      case "audio_ready":
        session.onAudioReady();
        break;
      case "cancel":
        session.onCancel();
        break;
      case "reset":
        session.onReset();
        break;
      case "history":
        session.onHistory(msg.messages);
        break;
    }
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

// Copyright 2025 the AAI authors. MIT license.
/**
 * Speech-to-Speech WebSocket client for AssemblyAI's S2S API.
 *
 * @module
 */
import * as log from "@std/log";
import { decodeBase64, encodeBase64 } from "@std/encoding/base64";
import type { S2SConfig } from "./types.ts";
import WebSocket from "ws";

export type S2sSessionConfig = {
  "system_prompt": string;
  tools: S2sToolSchema[];
  voice?: string;
  greeting?: string;
};

export type S2sToolSchema = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type S2sToolCall = {
  "call_id": string;
  name: string;
  args: string;
};

export type S2sHandle = EventTarget & {
  sendAudio(audio: Uint8Array): void;
  sendToolResult(callId: string, result: string): void;
  updateSession(config: S2sSessionConfig): void;
  resumeSession(sessionId: string): void;
  close(): void;
};

/**
 * Connect to AssemblyAI's Speech-to-Speech WebSocket API.
 *
 * Returns an {@linkcode S2sHandle} that extends EventTarget. Consumers
 * listen for events: `ready`, `speech_started`, `speech_stopped`,
 * `user_transcript_delta`, `user_transcript`, `reply_started`,
 * `reply_done`, `audio`, `agent_transcript`, `tool_call`,
 * `session_expired`, `error`, `close`.
 */
export function connectS2s(
  apiKey: string,
  config: S2SConfig,
): Promise<S2sHandle> {
  return new Promise((resolve, reject) => {
    log.debug("S2S connecting", { url: config.wssUrl });

    const ws = new WebSocket(config.wssUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    const target = new EventTarget();
    let opened = false;

    function send(msg: Record<string, unknown>): void {
      if (ws.readyState !== WebSocket.OPEN) return;
      const type = msg.type as string;
      if (type !== "input.audio") {
        log.info(`S2S >> ${JSON.stringify(msg)}`);
      }
      ws.send(JSON.stringify(msg));
    }

    const handle: S2sHandle = Object.assign(target, {
      sendAudio(audio: Uint8Array): void {
        send({ type: "input.audio", audio: encodeBase64(audio) });
      },

      sendToolResult(callId: string, result: string): void {
        send({ type: "tool.result", call_id: callId, result });
      },

      updateSession(sessionConfig: S2sSessionConfig): void {
        send({ type: "session.update", session: sessionConfig });
      },

      resumeSession(sessionId: string): void {
        send({ type: "session.resume", session_id: sessionId });
      },

      close(): void {
        log.debug("S2S closing");
        ws.close();
      },
    });

    ws.on("open", () => {
      opened = true;
      log.info("S2S WebSocket open");
      resolve(handle);
    });

    ws.on("message", (data: WebSocket.Data) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }

      const type = msg.type as string;

      if (type !== "reply.audio") {
        log.info(`S2S << ${JSON.stringify(msg)}`);
      }

      switch (type) {
        case "session.ready":
          target.dispatchEvent(
            new CustomEvent("ready", {
              detail: { session_id: msg.session_id as string },
            }),
          );
          break;
        case "session.updated":
          target.dispatchEvent(
            new CustomEvent("session_updated", { detail: msg }),
          );
          break;
        case "input.speech.started":
          target.dispatchEvent(new CustomEvent("speech_started"));
          break;
        case "input.speech.stopped":
          target.dispatchEvent(new CustomEvent("speech_stopped"));
          break;
        case "transcript.user.delta":
          target.dispatchEvent(
            new CustomEvent("user_transcript_delta", {
              detail: { text: msg.text as string },
            }),
          );
          break;
        case "transcript.user":
          target.dispatchEvent(
            new CustomEvent("user_transcript", {
              detail: {
                item_id: msg.item_id as string,
                text: msg.text as string,
              },
            }),
          );
          break;
        case "reply.started":
          target.dispatchEvent(
            new CustomEvent("reply_started", {
              detail: { reply_id: msg.reply_id as string },
            }),
          );
          break;
        case "reply.audio": {
          const audioBytes = decodeBase64(msg.data as string);
          target.dispatchEvent(
            new CustomEvent("audio", {
              detail: {
                reply_id: msg.reply_id as string,
                audio: audioBytes,
              },
            }),
          );
          break;
        }
        case "transcript.agent":
          target.dispatchEvent(
            new CustomEvent("agent_transcript", {
              detail: {
                reply_id: msg.reply_id as string,
                item_id: msg.item_id as string,
                text: msg.text as string,
              },
            }),
          );
          break;
        case "tool.call":
          target.dispatchEvent(
            new CustomEvent("tool_call", {
              detail: {
                call_id: msg.call_id as string,
                name: msg.name as string,
                args: msg.args as string,
              },
            }),
          );
          break;
        case "reply.done":
          target.dispatchEvent(
            new CustomEvent("reply_done", {
              detail: {
                reply_id: msg.reply_id as string,
                status: msg.status as string,
              },
            }),
          );
          break;
        case "session.error": {
          const code = msg.code as string;
          const isExpired = code === "session_not_found" ||
            code === "session_forbidden";
          target.dispatchEvent(
            new CustomEvent(isExpired ? "session_expired" : "error", {
              detail: { code, message: msg.message as string },
            }),
          );
          break;
        }
      }
    });

    ws.on("close", (code: number, reason: Uint8Array) => {
      log.info("S2S WebSocket closed", {
        code,
        reason: new TextDecoder().decode(reason),
      });
      target.dispatchEvent(new CustomEvent("close"));
    });

    ws.on("error", (err: Error) => {
      log.error("S2S WebSocket error", { error: err.message });
      if (!opened) {
        reject(err);
      } else {
        target.dispatchEvent(
          new CustomEvent("error", {
            detail: { code: "ws_error", message: err.message },
          }),
        );
      }
    });
  });
}

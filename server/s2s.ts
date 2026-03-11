// Speech-to-Speech WebSocket client for AssemblyAI's S2S API.

import { encodeBase64 } from "@std/encoding/base64";
import { decodeBase64 } from "@std/encoding/base64";
import WebSocket from "ws";

export type S2sConfig = {
  wssUrl: string;
  inputSampleRate: number;
  outputSampleRate: number;
};

export const DEFAULT_S2S_CONFIG: S2sConfig = {
  wssUrl: "wss://speech-to-speech.us.assemblyai.com/v1/realtime",
  inputSampleRate: 16_000,
  outputSampleRate: 24_000,
};

export type S2sToolSchema = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type S2sSessionConfig = {
  system_prompt: string;
  tools: S2sToolSchema[];
  voice?: string;
  input_sample_rate?: number;
  output_sample_rate?: number;
};

export type S2sToolCall = {
  call_id: string;
  name: string;
  args: string;
};

export type S2sReplyDone = {
  reply_id: string;
  status: "completed" | "interrupted";
};

export type S2sHandle = EventTarget & {
  sendAudio(audio: Uint8Array): void;
  sendToolResult(callId: string, result: string): void;
  updateSession(config: S2sSessionConfig): void;
  resumeSession(sessionId: string): void;
  close(): void;
};

export function connectS2s(
  apiKey: string,
  config: S2sConfig,
): Promise<S2sHandle> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(config.wssUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    const target = new EventTarget();
    let opened = false;

    const handle: S2sHandle = Object.assign(target, {
      sendAudio(audio: Uint8Array): void {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({
          type: "input.audio",
          audio: encodeBase64(audio),
        }));
      },

      sendToolResult(callId: string, result: string): void {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({
          type: "tool.result",
          call_id: callId,
          result,
        }));
      },

      updateSession(sessionConfig: S2sSessionConfig): void {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({
          type: "session.update",
          session: sessionConfig,
        }));
      },

      resumeSession(sessionId: string): void {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({
          type: "session.resume",
          session_id: sessionId,
        }));
      },

      close(): void {
        ws.close();
      },
    });

    ws.on("open", () => {
      opened = true;
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
          const audioB64 = msg.data as string;
          const audioBytes = decodeBase64(audioB64);
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
              detail: {
                code,
                message: msg.message as string,
              },
            }),
          );
          break;
        }
      }
    });

    ws.on("close", () => {
      target.dispatchEvent(new CustomEvent("close"));
    });

    ws.on("error", (err: Error) => {
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

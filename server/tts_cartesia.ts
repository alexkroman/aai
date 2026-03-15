// Copyright 2025 the AAI authors. MIT license.
import * as log from "@std/log";
import type { CartesiaTtsConfig } from "./types.ts";
import * as metrics from "./metrics.ts";
import type { TtsConnection } from "./tts.ts";

const CARTESIA_WSS_URL = "wss://api.cartesia.ai/tts/websocket";
const API_VERSION = "2025-04-16";

/**
 * Creates a new streaming TTS connection to the Cartesia service.
 *
 * Uses the raw Cartesia WebSocket API, matching the protocol used by the
 * official Cartesia JS SDK: send() for the first chunk, continue() for
 * subsequent chunks, and an empty transcript with continue:false to close.
 */
export function createCartesiaTtsConnection(
  config: CartesiaTtsConfig,
): TtsConnection {
  let closed = false;
  let ws: WebSocket | null = null;
  let lastError: string | null = null;
  let connectingPromise: Promise<WebSocket> | null = null;

  const lifecycle = new AbortController();

  // Per-synthesis state
  let chunkCount = 0;
  let onAudioCb: ((chunk: Uint8Array) => void) | null = null;
  let completionResolve: (() => void) | null = null;
  let completionReject: ((err: Error) => void) | null = null;
  let contextId = "";

  function finishSynthesis(error?: string): void {
    if (error && completionReject) {
      completionReject(new Error(error));
      completionReject = null;
      completionResolve = null;
    } else if (completionResolve) {
      completionResolve();
      completionResolve = null;
      completionReject = null;
    }
    onAudioCb = null;
    contextId = "";
  }

  function handleMessage(event: MessageEvent): void {
    if (typeof event.data !== "string") return;
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    // Only handle messages for the current context
    if (msg.context_id && msg.context_id !== contextId) return;

    // The SDK checks `message.done` (boolean), not `message.type`
    if (msg.done) {
      finishSynthesis();
    } else if (msg.type === "chunk" && msg.data) {
      chunkCount++;
      const bytes = base64ToUint8Array(msg.data);
      if (bytes.byteLength > 0) {
        onAudioCb?.(bytes);
      }
    } else if (msg.type === "error") {
      lastError = msg.error ?? msg.message ?? "Cartesia TTS error (unknown)";
      log.error(`Cartesia TTS error: ${lastError}`, {
        statusCode: msg.status_code,
        contextId: msg.context_id,
      });
      finishSynthesis(lastError ?? undefined);
    }
  }

  function handleClose(event: CloseEvent): void {
    if (event.code !== 1000 && event.code !== 1005) {
      lastError = event.reason
        ? `TTS connection closed: ${event.reason} (code ${event.code})`
        : `TTS connection closed unexpectedly (code ${event.code})`;
      log.error(lastError);
    }
    ws = null;
    finishSynthesis();
  }

  function handleError(): void {
    lastError = config.apiKey
      ? "TTS WebSocket error — check CARTESIA_API_KEY"
      : "TTS WebSocket error — CARTESIA_API_KEY is not set";
    log.error(lastError);
    ws = null;
    finishSynthesis();
  }

  async function connect(): Promise<WebSocket> {
    if (ws && ws.readyState === WebSocket.OPEN) {
      return ws;
    }
    if (connectingPromise) return connectingPromise;

    if (ws) {
      ws.close();
      ws = null;
    }

    const params = new URLSearchParams({
      "cartesia_version": API_VERSION,
      "api_key": config.apiKey,
    });
    const newWs = new WebSocket(`${CARTESIA_WSS_URL}?${params}`);
    ws = newWs;

    newWs.addEventListener("message", handleMessage);
    newWs.addEventListener("close", handleClose);
    newWs.addEventListener("error", handleError);

    connectingPromise = new Promise<WebSocket>((resolve, reject) => {
      newWs.addEventListener("open", () => {
        lastError = null;
        connectingPromise = null;
        log.info("TTS WebSocket connected (Cartesia)");
        resolve(newWs);
      }, { once: true });
      newWs.addEventListener("error", () => {
        connectingPromise = null;
        reject(
          new Error(lastError ?? "TTS WebSocket connection failed"),
        );
      }, { once: true });
    });
    return connectingPromise;
  }

  /** Build a Cartesia WebSocket message. */
  function buildMessage(
    transcript: string,
    ctxId: string,
    continuation?: boolean,
  ): string {
    return JSON.stringify({
      "model_id": config.modelId,
      transcript,
      voice: { mode: "id", id: config.voice },
      "output_format": {
        container: "raw",
        encoding: "pcm_s16le",
        "sample_rate": config.sampleRate,
      },
      "context_id": ctxId,
      ...(continuation !== undefined ? { continue: continuation } : {}),
    });
  }

  function waitForCompletion(signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      completionResolve = resolve;
      completionReject = reject;

      if (signal) {
        signal.addEventListener("abort", () => {
          log.info("TTS aborted (Cartesia)");
          finishSynthesis();
        }, { once: true });
      }
    });
  }

  return {
    get closed(): boolean {
      return closed;
    },

    async warmup(): Promise<void> {
      if (lifecycle.signal.aborted || ws) return;
      try {
        await connect();
      } catch (e) {
        log.warn(
          "TTS warmup failed (Cartesia), will retry on synthesize",
          e,
        );
      }
    },

    async synthesizeStream(
      chunks: string | AsyncIterable<string>,
      onAudio: (chunk: Uint8Array) => void,
      signal?: AbortSignal,
      onText?: (text: string) => void,
    ): Promise<void> {
      if (lifecycle.signal.aborted || signal?.aborted) return;

      const ttsStart = performance.now();

      try {
        const conn = await connect();
        if (signal?.aborted) return;

        contextId = crypto.randomUUID();
        chunkCount = 0;
        onAudioCb = onAudio;

        if (typeof chunks === "string") {
          if (!chunks.trim()) {
            finishSynthesis();
            return;
          }
          onText?.(chunks);
          // Single string: send without continue flag
          conn.send(buildMessage(chunks, contextId));
        } else {
          // Streaming: first chunk via send (no continue flag),
          // subsequent chunks with continue:true,
          // empty transcript with continue:false to close.
          let started = false;
          for await (const text of chunks) {
            if (signal?.aborted) return;
            if (!text) continue;
            onText?.(text);
            conn.send(buildMessage(text, contextId, true));
            started = true;
          }
          if (!started) {
            finishSynthesis();
            return;
          }
          conn.send(buildMessage("", contextId, false));
        }
        await waitForCompletion(signal);
      } finally {
        metrics.ttsDuration.observe(
          (performance.now() - ttsStart) / 1000,
        );
      }
    },

    close(): void {
      if (closed) return;
      closed = true;
      lifecycle.abort();
      finishSynthesis();
      if (ws) {
        ws.close();
        ws = null;
      }
    },
  };
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binStr = atob(b64);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) {
    bytes[i] = binStr.charCodeAt(i);
  }
  return bytes;
}

// Copyright 2025 the AAI authors. MIT license.
import * as log from "@std/log";
import { debounce } from "@std/async/debounce";
import type { RimeTtsConfig } from "./types.ts";
import { createWebSocketWithHeaders } from "./_deno_ws.ts";
import * as metrics from "./metrics.ts";
import type { TtsConnection } from "./tts.ts";

const IDLE_MS = 300;
const NO_AUDIO_TIMEOUT_MS = 5000;

/**
 * Creates a new streaming TTS connection to the Rime service.
 *
 * The connection manages a persistent WebSocket, automatically reconnects
 * on failure, and uses idle-based completion detection with a safety timeout.
 */
export function createRimeTtsConnection(config: RimeTtsConfig): TtsConnection {
  let closed = false;
  let ws: WebSocket | null = null;
  let lastError: string | null = null;
  let connectingPromise: Promise<WebSocket> | null = null;

  let onAudioCb: ((chunk: Uint8Array) => void) | null = null;
  let completionResolve: (() => void) | null = null;
  let safetyTimer: ReturnType<typeof setTimeout> | null = null;
  let chunkCount = 0;
  let totalBytes = 0;

  const lifecycle = new AbortController();
  const idleFinish = debounce(() => finishSynthesis(), IDLE_MS);

  function finishSynthesis(): void {
    idleFinish.clear();
    if (safetyTimer) {
      clearTimeout(safetyTimer);
      safetyTimer = null;
    }
    if (completionResolve) {
      completionResolve();
      completionResolve = null;
    }
    onAudioCb = null;
    chunkCount = 0;
    totalBytes = 0;
  }

  function handleMessage(event: MessageEvent): void {
    if (event.data instanceof ArrayBuffer && event.data.byteLength > 0) {
      chunkCount++;
      totalBytes += event.data.byteLength;
      onAudioCb?.(new Uint8Array(event.data));
      if (safetyTimer) {
        clearTimeout(safetyTimer);
        safetyTimer = null;
      }
      idleFinish();
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
      ? "TTS WebSocket error — check RIME_API_KEY"
      : "TTS WebSocket error — RIME_API_KEY is not set";
    log.error(lastError);
    ws = null;
    finishSynthesis();
  }

  async function connect(): Promise<WebSocket> {
    if (ws && ws.readyState === WebSocket.OPEN) {
      return ws;
    }
    // If a connection attempt is already in flight, reuse it
    if (connectingPromise) return connectingPromise;

    if (ws) {
      ws.close();
      ws = null;
    }

    const params = new URLSearchParams({
      speaker: config.voice,
      modelId: config.modelId,
      audioFormat: config.audioFormat,
      samplingRate: String(config.samplingRate),
    });
    if (config.speedAlpha != null) {
      params.set("speedAlpha", String(config.speedAlpha));
    }
    const newWs = createWebSocketWithHeaders(`${config.wssUrl}?${params}`, {
      Authorization: `Bearer ${config.apiKey}`,
    });
    newWs.binaryType = "arraybuffer";
    ws = newWs;

    newWs.addEventListener("message", handleMessage);
    newWs.addEventListener("close", handleClose);
    newWs.addEventListener("error", handleError);

    connectingPromise = new Promise<WebSocket>((resolve, reject) => {
      newWs.addEventListener("open", () => {
        lastError = null;
        connectingPromise = null;
        log.info("TTS WebSocket connected (Rime)");
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

  function waitForCompletion(signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
      completionResolve = resolve;

      safetyTimer = setTimeout(
        () => finishSynthesis(),
        NO_AUDIO_TIMEOUT_MS,
      );

      if (signal) {
        signal.addEventListener("abort", () => {
          log.info("TTS aborted", { chunkCount, totalBytes });
          if (ws) {
            ws.close();
            ws = null;
          }
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
        log.warn("TTS warmup failed, will retry on synthesize", e);
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

        onAudioCb = onAudio;

        if (typeof chunks === "string") {
          onText?.(chunks);
          conn.send(chunks);
        } else {
          for await (const text of chunks) {
            if (signal?.aborted) return;
            if (text) onText?.(text);
            conn.send(text);
          }
        }
        conn.send("<FLUSH>");
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
        if (ws.readyState === WebSocket.OPEN) {
          ws.send("<EOS>");
        }
        ws.close();
        ws = null;
      }
    },
  };
}

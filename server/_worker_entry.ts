// Copyright 2025 the AAI authors. MIT license.
/**
 * Host-side worker API — communicates with sandboxed agent workers via Comlink.
 *
 * @module
 */

import * as Comlink from "comlink";
import type { Message } from "@aai/sdk/types";
import type {
  ExposedWorkerApi,
  HostApi,
  StepInfoRpc,
} from "@aai/sdk/worker-entry";
import { deadline } from "@std/async/deadline";

export type {
  ExecuteTool,
  ExposedWorkerApi,
  HostApi,
  KvRequest,
  StepInfoRpc,
  WorkerConfig,
} from "@aai/sdk/worker-entry";
export {
  executeToolCall,
  startWorker,
  TOOL_HANDLER_TIMEOUT,
} from "@aai/sdk/worker-entry";

/**
 * High-level API for communicating with a sandboxed agent worker.
 *
 * This is the host-side interface returned by {@linkcode createWorkerApi}.
 * All methods automatically wait for the Comlink connection to be ready
 * and support optional RPC timeouts.
 */
export type WorkerApi = {
  /**
   * Retrieve the agent's configuration and tool schemas from the worker.
   *
   * @returns The agent config and tool JSON schemas.
   */
  getConfig(): Promise<import("@aai/sdk/types").WorkerConfig>;

  /**
   * Execute a named tool in the worker's sandbox.
   *
   * @param name - Tool name to invoke.
   * @param args - Arguments to pass to the tool handler.
   * @param sessionId - Optional session identifier.
   * @param timeoutMs - Optional RPC timeout in milliseconds.
   * @param env - Optional environment variables to merge.
   * @param messages - Optional conversation history.
   * @returns The tool result as a string.
   */
  executeTool(
    name: string,
    args: Readonly<Record<string, unknown>>,
    sessionId?: string,
    timeoutMs?: number,
    env?: Record<string, string>,
    messages?: readonly Message[],
  ): Promise<string>;

  /**
   * Notify the worker that a new session has connected.
   *
   * @param sessionId - The session identifier.
   * @param timeoutMs - Optional RPC timeout in milliseconds.
   * @param env - Optional environment variables to merge.
   */
  onConnect(
    sessionId: string,
    timeoutMs?: number,
    env?: Record<string, string>,
  ): Promise<void>;

  /**
   * Notify the worker that a session has disconnected.
   *
   * @param sessionId - The session identifier.
   * @param timeoutMs - Optional RPC timeout in milliseconds.
   * @param env - Optional environment variables to merge.
   */
  onDisconnect(
    sessionId: string,
    timeoutMs?: number,
    env?: Record<string, string>,
  ): Promise<void>;

  /**
   * Notify the worker that a user turn has been finalized.
   *
   * @param sessionId - The session identifier.
   * @param text - The finalized user transcript text.
   * @param timeoutMs - Optional RPC timeout in milliseconds.
   * @param env - Optional environment variables to merge.
   */
  onTurn(
    sessionId: string,
    text: string,
    timeoutMs?: number,
    env?: Record<string, string>,
  ): Promise<void>;

  /**
   * Notify the worker that an error occurred during the session.
   *
   * @param sessionId - The session identifier.
   * @param error - The error message string.
   * @param timeoutMs - Optional RPC timeout in milliseconds.
   * @param env - Optional environment variables to merge.
   */
  onError(
    sessionId: string,
    error: string,
    timeoutMs?: number,
    env?: Record<string, string>,
  ): Promise<void>;

  /**
   * Notify the worker about a completed agentic loop step.
   *
   * @param sessionId - The session identifier.
   * @param step - The step info payload (tool calls and text).
   * @param timeoutMs - Optional RPC timeout in milliseconds.
   * @param env - Optional environment variables to merge.
   */
  onStep(
    sessionId: string,
    step: StepInfoRpc,
    timeoutMs?: number,
    env?: Record<string, string>,
  ): Promise<void>;

  /**
   * Ask the worker to resolve the dynamic max steps for the current session.
   *
   * @param sessionId - The session identifier.
   * @param timeoutMs - Optional RPC timeout in milliseconds.
   * @param env - Optional environment variables to merge.
   * @returns The max steps number, or `null` if not dynamically configured.
   */
  resolveMaxSteps(
    sessionId: string,
    timeoutMs?: number,
    env?: Record<string, string>,
  ): Promise<number | null>;

  /**
   * Ask the worker to run the `onBeforeStep` hook for filtering active tools.
   *
   * @param sessionId - The session identifier.
   * @param stepNumber - The upcoming step number.
   * @param timeoutMs - Optional RPC timeout in milliseconds.
   * @param env - Optional environment variables to merge.
   * @returns An object with `activeTools` filter, or `null` if no hook defined.
   */
  resolveBeforeStep(
    sessionId: string,
    stepNumber: number,
    timeoutMs?: number,
    env?: Record<string, string>,
  ): Promise<{ activeTools?: string[] } | null>;

  /** Release the underlying Comlink proxy and its MessagePort resources. */
  dispose?: () => Promise<void>;
};

function withTimeout<T>(promise: Promise<T>, timeoutMs?: number): Promise<T> {
  if (!timeoutMs) return promise;
  return deadline(promise, timeoutMs).catch((err) => {
    throw err.name === "TimeoutError"
      ? new Error(`RPC timed out after ${timeoutMs}ms`)
      : err;
  });
}

/**
 * Create a {@linkcode WorkerApi} backed by Comlink over a Worker or MessagePort.
 *
 * Wraps a Comlink endpoint to produce the host-side API for communicating with
 * a sandboxed agent worker. If `hostApi` is provided, a dedicated MessageChannel
 * is created so the worker can proxy fetch and KV requests back to the host.
 *
 * @param endpoint - The Comlink endpoint (typically a `Worker` or `MessagePort`).
 * @param hostApi - Optional host-side API to expose to the worker for fetch/kv proxy.
 * @returns A {@linkcode WorkerApi} instance with timeout-wrapped RPC methods.
 *
 * @example
 * ```ts
 * const worker = createDenoWorker(specifier, "agent", LOCKED_PERMISSIONS);
 * const api = createWorkerApi(worker, { fetch: hostFetch, kv: hostKv });
 * const config = await api.getConfig();
 * ```
 */
export function createWorkerApi(
  endpoint: Comlink.Endpoint,
  hostApi?: HostApi,
): WorkerApi {
  const remote = Comlink.wrap<ExposedWorkerApi>(endpoint);
  let hostPort: MessagePort | undefined;
  let ready: Promise<void>;

  if (hostApi) {
    const ch = new MessageChannel();
    hostPort = ch.port1;
    Comlink.expose(hostApi, ch.port1);
    ready = remote.init(Comlink.transfer(ch.port2, [ch.port2]));
  } else {
    ready = Promise.resolve();
  }

  return {
    async getConfig() {
      await ready;
      return await withTimeout(remote.getConfig(), 5_000);
    },
    async executeTool(name, args, sessionId, timeoutMs, env, messages) {
      await ready;
      const raw = await withTimeout(
        remote.executeTool(name, args, sessionId, env, messages),
        timeoutMs,
      );
      return typeof raw === "string" ? raw : String(raw ?? "");
    },
    async onConnect(sessionId, timeoutMs, env) {
      await ready;
      await withTimeout(remote.onConnect(sessionId, env), timeoutMs);
    },
    async onDisconnect(sessionId, timeoutMs, env) {
      await ready;
      await withTimeout(remote.onDisconnect(sessionId, env), timeoutMs);
    },
    async onTurn(sessionId, text, timeoutMs, env) {
      await ready;
      await withTimeout(remote.onTurn(sessionId, text, env), timeoutMs);
    },
    async onError(sessionId, error, timeoutMs, env) {
      await ready;
      await withTimeout(remote.onError(sessionId, error, env), timeoutMs);
    },
    async onStep(sessionId, step, timeoutMs, env) {
      await ready;
      await withTimeout(
        remote.onStep(sessionId, JSON.stringify(step), env),
        timeoutMs,
      );
    },
    async resolveMaxSteps(sessionId, timeoutMs, env) {
      await ready;
      return await withTimeout(
        remote.resolveMaxSteps(sessionId, env),
        timeoutMs ?? 5_000,
      );
    },
    async resolveBeforeStep(sessionId, stepNumber, timeoutMs, env) {
      await ready;
      return await withTimeout(
        remote.resolveBeforeStep(sessionId, stepNumber, env),
        timeoutMs ?? 5_000,
      );
    },
    async dispose() {
      await remote.dispose();
      remote[Comlink.releaseProxy]();
      hostPort?.close();
    },
  };
}

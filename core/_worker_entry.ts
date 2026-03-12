// Copyright 2025 the AAI authors. MIT license.
/**
 * Worker entry point — runs agent code in a sandboxed Deno Worker.
 *
 * @module
 */

import * as log from "@std/log";
import * as Comlink from "comlink";
import { z } from "zod";
import type {
  AgentDef,
  HookContext,
  Message,
  ToolContext,
  ToolDef,
} from "@aai/sdk/types";
import type { AgentConfig, ToolSchema, WorkerConfig } from "@aai/sdk/types";
import type { Kv, KvEntry } from "@aai/sdk/kv";
import { deadline } from "@std/async/deadline";

/**
 * Maximum time in milliseconds a tool handler may run before being aborted.
 *
 * If a tool's `execute` function exceeds this duration, it is cancelled via
 * `AbortSignal.timeout` and an error message is returned to the LLM.
 */
export const TOOL_HANDLER_TIMEOUT = 30_000;

/**
 * Function signature for executing a tool by name.
 *
 * @param name - The tool name to execute.
 * @param args - Key-value arguments to pass to the tool handler.
 * @param sessionId - Optional session identifier for stateful tools.
 * @param messages - Optional conversation history for context-aware tools.
 * @returns The tool's string result, or an error message string.
 */
export type ExecuteTool = (
  name: string,
  args: Readonly<Record<string, unknown>>,
  sessionId?: string,
  messages?: readonly Message[],
) => Promise<string>;

/**
 * Execute a tool call with argument validation, timeout, and error handling.
 *
 * Validates the provided arguments against the tool's Zod parameter schema,
 * constructs a {@linkcode ToolContext}, invokes the tool's `execute` function,
 * and serializes the result to a string. Errors and timeouts are caught and
 * returned as `"Error: ..."` strings rather than thrown.
 *
 * @param name - The name of the tool being invoked.
 * @param args - Raw arguments from the LLM to validate and pass to the tool.
 * @param tool - The tool definition containing schema and execute function.
 * @param env - Environment variables available to the tool handler.
 * @param sessionId - Optional session identifier for the current connection.
 * @param state - Optional per-session state object.
 * @param kv - Optional key-value store proxy for persistent storage.
 * @param messages - Optional conversation history for context-aware tools.
 * @returns The tool's result serialized as a string, or an error message.
 *
 * @example
 * ```ts
 * const result = await executeToolCall(
 *   "lookup",
 *   { query: "weather" },
 *   myToolDef,
 *   { API_KEY: "abc" },
 * );
 * ```
 */
export async function executeToolCall(
  name: string,
  args: Readonly<Record<string, unknown>>,
  tool: ToolDef,
  env: Readonly<Record<string, string>>,
  sessionId?: string,
  state?: unknown,
  kv?: Kv,
  messages?: readonly Message[],
): Promise<string> {
  const schema = tool.parameters ?? z.object({});
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    const issues = (parsed.error?.issues ?? [])
      .map((i: z.ZodIssue) => `${i.path.map(String).join(".")}: ${i.message}`)
      .join(", ");
    return `Error: Invalid arguments for tool "${name}": ${issues}`;
  }

  try {
    const abortSignal = AbortSignal.timeout(TOOL_HANDLER_TIMEOUT);
    const envCopy = { ...env };
    const ctx: ToolContext = {
      sessionId: sessionId ?? "",
      env: envCopy,
      abortSignal,
      state: (state ?? {}) as Record<string, unknown>,
      get kv(): Kv {
        if (!kv) throw new Error("KV not available");
        return kv;
      },
      messages: messages ?? [],
    };
    const result = await Promise.resolve(
      tool.execute(parsed.data, ctx),
    );
    if (result == null) return "null";
    return typeof result === "string" ? result : JSON.stringify(result);
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      log.warn(`[tool-executor] Tool execution timed out: ${name}`);
      return `Error: Tool "${name}" timed out after ${TOOL_HANDLER_TIMEOUT}ms`;
    }
    log.warn(`[tool-executor] Tool execution failed: ${name}`, err);
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export type { WorkerConfig } from "@aai/sdk/types";

/**
 * Step info payload for RPC transport between host and worker.
 *
 * Represents one iteration of the agentic loop, including which tools were
 * called and any text the LLM produced. This is serialized to JSON when
 * sent to the worker's `onStep` handler.
 */
export type StepInfoRpc = {
  /** The 1-based step number within the current turn. */
  stepNumber: number;
  /** Tools invoked during this step, with their arguments. */
  toolCalls: readonly {
    toolName: string;
    args: Readonly<Record<string, unknown>>;
  }[];
  /** The LLM's text output for this step. */
  text: string;
};

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
  getConfig(): Promise<WorkerConfig>;

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

import type { KvRequest } from "./_protocol.ts";
export type { KvRequest };

/**
 * API shape the host process exposes to the sandboxed worker via Comlink.
 *
 * Since workers run with all permissions denied (`net: false`, etc.),
 * they use this interface to proxy network requests and KV operations
 * back to the host process over a dedicated `MessagePort`.
 */
export type HostApi = {
  /**
   * Proxy an HTTP fetch request through the host process.
   *
   * The host validates the URL via `assertPublicUrl()` for SSRF protection
   * before executing the real fetch.
   *
   * @param req - The serialized request (URL, method, headers, body).
   * @returns The serialized response (status, headers, body).
   */
  fetch(req: {
    url: string;
    method: string;
    headers: Readonly<Record<string, string>>;
    body: string | null;
  }): Promise<{
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
  }>;

  /**
   * Proxy a KV store operation through the host process.
   *
   * @param req - The KV operation request (get, set, del, or list).
   * @returns An object containing the operation result.
   */
  kv(req: KvRequest): Promise<{ result: unknown }>;
};

/**
 * API shape exposed by the worker to the host via Comlink.
 *
 * This is the low-level interface that runs inside the sandboxed Deno Worker.
 * The host communicates with it through {@linkcode WorkerApi}, which wraps
 * this interface with timeout handling and JSON serialization.
 */
export type ExposedWorkerApi = {
  /**
   * Receive a MessagePort for calling back to the host (fetch/kv proxy).
   *
   * @param hostPort - The transferred MessagePort connected to the host's HostApi.
   */
  init(hostPort: MessagePort): void;

  /** Release the host callback port (for clean test teardown). */
  dispose(): void;

  /**
   * Return the agent config and tool schemas extracted from the agent definition.
   *
   * @returns The worker config containing agent settings and tool JSON schemas.
   */
  getConfig(): WorkerConfig;

  /**
   * Execute a named tool within the worker sandbox.
   *
   * @param name - The tool name to invoke.
   * @param args - Arguments to pass to the tool handler.
   * @param sessionId - Optional session identifier.
   * @param env - Optional environment variables to merge.
   * @param messages - Optional conversation history.
   * @returns The tool result as a string.
   */
  executeTool(
    name: string,
    args: Readonly<Record<string, unknown>>,
    sessionId?: string,
    env?: Record<string, string>,
    messages?: readonly Message[],
  ): Promise<string>;

  /**
   * Called when a new session connects.
   *
   * @param sessionId - The session identifier.
   * @param env - Optional environment variables to merge.
   */
  onConnect(sessionId: string, env?: Record<string, string>): Promise<void>;

  /**
   * Called when a session disconnects. Cleans up per-session state.
   *
   * @param sessionId - The session identifier.
   * @param env - Optional environment variables to merge.
   */
  onDisconnect(sessionId: string, env?: Record<string, string>): Promise<void>;

  /**
   * Called when a user turn is finalized.
   *
   * @param sessionId - The session identifier.
   * @param text - The finalized user transcript.
   * @param env - Optional environment variables to merge.
   */
  onTurn(
    sessionId: string,
    text: string,
    env?: Record<string, string>,
  ): Promise<void>;

  /**
   * Called when an error occurs in the session.
   *
   * @param sessionId - The session identifier.
   * @param error - The error message.
   * @param env - Optional environment variables to merge.
   */
  onError(
    sessionId: string,
    error: string,
    env?: Record<string, string>,
  ): Promise<void>;

  /**
   * Called after each agentic loop step completes.
   *
   * @param sessionId - The session identifier.
   * @param stepJson - The step info serialized as JSON.
   * @param env - Optional environment variables to merge.
   */
  onStep(
    sessionId: string,
    stepJson: string,
    env?: Record<string, string>,
  ): Promise<void>;

  /**
   * Resolve the dynamic max steps for the current session.
   *
   * @param sessionId - The session identifier.
   * @param env - Optional environment variables to merge.
   * @returns The max steps number, or `null` if statically configured.
   */
  resolveMaxSteps(
    sessionId: string,
    env?: Record<string, string>,
  ): Promise<number | null>;

  /**
   * Run the `onBeforeStep` hook to filter active tools for the next step.
   *
   * @param sessionId - The session identifier.
   * @param stepNumber - The upcoming step number.
   * @param env - Optional environment variables to merge.
   * @returns An object with `activeTools` filter, or `null` if no hook defined.
   */
  resolveBeforeStep(
    sessionId: string,
    stepNumber: number,
    env?: Record<string, string>,
  ): Promise<{ activeTools?: string[] } | null>;
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

/**
 * Start the worker-side Comlink endpoint that serves agent RPC calls.
 *
 * Called inside a sandboxed Deno Worker to expose the agent's tools, hooks,
 * and configuration to the host process. Sets up per-session state management,
 * environment variable merging, and Comlink-based communication.
 *
 * @param agent - The agent definition returned by `defineAgent()`.
 * @param env - Initial environment variables available to the agent.
 * @param endpoint - Optional Comlink endpoint; defaults to `self` (the Worker global).
 *
 * @example
 * ```ts
 * import { startWorker } from "@aai/core/worker-entry";
 * import agent from "./agent.ts";
 *
 * startWorker(agent, {});
 * ```
 */
export function startWorker(
  agent: AgentDef,
  env: Readonly<Record<string, string>>,
  endpoint?: Comlink.Endpoint,
): void {
  const toolHandlers = new Map(Object.entries(agent.tools));
  const sessions = new Map<string, unknown>();
  let mergedEnv = { ...env };
  let proxyKv: Kv | undefined;
  let hostPort: MessagePort | undefined;

  function applyEnv(extra?: Record<string, string>): void {
    if (extra) mergedEnv = { ...mergedEnv, ...extra };
  }

  function getState(sessionId: string): unknown {
    if (!sessions.has(sessionId) && agent.state) {
      sessions.set(sessionId, agent.state());
    }
    return sessions.get(sessionId) ?? {};
  }

  function makeCtx(sessionId: string): HookContext {
    return {
      sessionId,
      env: { ...mergedEnv },
      state: getState(sessionId) as Record<string, unknown>,
      get kv() {
        if (!proxyKv) throw new Error("KV not available");
        return proxyKv;
      },
    };
  }

  const EMPTY_PARAMS = z.object({});

  const api: ExposedWorkerApi = {
    init(port: MessagePort) {
      hostPort = port;
      const remote = Comlink.wrap<HostApi>(port);
      proxyKv = createProxyKv(remote);
      installFetchProxy(remote);
    },

    dispose() {
      hostPort?.close();
    },

    getConfig(): WorkerConfig {
      const toolSchemas: ToolSchema[] = Object.entries(agent.tools).map(
        ([name, def]) => ({
          name,
          description: def.description,
          parameters: z.toJSONSchema(
            def.parameters ?? EMPTY_PARAMS,
          ) as ToolSchema["parameters"],
        }),
      );
      const config: AgentConfig = {
        name: agent.name,
        mode: agent.mode,
        instructions: agent.instructions,
        greeting: agent.greeting,
        voice: agent.voice,
      };
      if (agent.sttPrompt !== undefined) config.sttPrompt = agent.sttPrompt;
      if (typeof agent.maxSteps !== "function") {
        config.maxSteps = agent.maxSteps;
      }
      if (agent.toolChoice !== undefined) config.toolChoice = agent.toolChoice;
      if (agent.builtinTools) config.builtinTools = [...agent.builtinTools];
      return { config, toolSchemas };
    },

    async executeTool(name, args, sessionId, env, messages) {
      applyEnv(env);
      const tool = toolHandlers.get(name);
      if (!tool) return `Error: Unknown tool "${name}"`;
      return await executeToolCall(
        name,
        args,
        tool,
        mergedEnv,
        sessionId,
        getState(sessionId ?? ""),
        proxyKv,
        messages,
      );
    },

    async onConnect(sessionId, env) {
      applyEnv(env);
      await agent.onConnect?.(makeCtx(sessionId));
    },

    async onDisconnect(sessionId, env) {
      applyEnv(env);
      await agent.onDisconnect?.(makeCtx(sessionId));
      sessions.delete(sessionId);
    },

    async onTurn(sessionId, text, env) {
      applyEnv(env);
      await agent.onTurn?.(text, makeCtx(sessionId));
    },

    // deno-lint-ignore require-await
    async onError(sessionId, error, env) {
      applyEnv(env);
      agent.onError?.(new Error(error), makeCtx(sessionId));
    },

    async onStep(sessionId, stepJson, env) {
      applyEnv(env);
      const step = JSON.parse(stepJson);
      await agent.onStep?.(step, makeCtx(sessionId));
    },

    // deno-lint-ignore require-await
    async resolveMaxSteps(sessionId, env) {
      applyEnv(env);
      if (typeof agent.maxSteps !== "function") return null;
      return agent.maxSteps(makeCtx(sessionId));
    },

    async resolveBeforeStep(sessionId, stepNumber, env) {
      applyEnv(env);
      if (!agent.onBeforeStep) return null;
      const result = await agent.onBeforeStep(stepNumber, makeCtx(sessionId));
      return result ?? null;
    },
  };

  const port = endpoint ?? (self as unknown as Comlink.Endpoint);
  Comlink.expose(api, port);
}

const KV_TIMEOUT_MS = 10_000;

function createProxyKv(hostApi: Comlink.Remote<HostApi>): Kv {
  async function kvCall(req: KvRequest): Promise<unknown> {
    const resp = await withTimeout(hostApi.kv(req), KV_TIMEOUT_MS);
    return (resp as { result: unknown }).result;
  }

  return {
    async get<T = unknown>(key: string): Promise<T | null> {
      const result = await kvCall({ op: "get", key });
      if (result === null || result === undefined) return null;
      return (typeof result === "string" ? JSON.parse(result) : result) as T;
    },

    async set(
      key: string,
      value: unknown,
      options?: { expireIn?: number },
    ): Promise<void> {
      const raw = JSON.stringify(value);
      await kvCall({
        op: "set",
        key,
        value: raw,
        ...(options?.expireIn
          ? { ttl: Math.ceil(options.expireIn / 1000) }
          : {}),
      });
    },

    async delete(key: string): Promise<void> {
      await kvCall({ op: "del", key });
    },

    async list<T = unknown>(
      prefix: string,
      options?: { limit?: number; reverse?: boolean },
    ): Promise<KvEntry<T>[]> {
      const listReq: KvRequest = {
        op: "list" as const,
        prefix,
        ...(options?.limit !== undefined ? { limit: options.limit } : {}),
        ...(options?.reverse !== undefined ? { reverse: options.reverse } : {}),
      };
      const result = await kvCall(listReq);
      return result as KvEntry<T>[];
    },
  };
}

const FETCH_TIMEOUT_MS = 30_000;

/**
 * Serialize a `BodyInit` value to a string suitable for RPC transport.
 *
 * Handles `string`, `URLSearchParams`, `ArrayBuffer`, `Blob`,
 * `ReadableStream`, and `FormData` inputs. Used internally by the fetch
 * proxy to serialize request bodies before sending them over Comlink.
 *
 * @param body - The request body to serialize.
 * @returns The body as a string, or `null` if the input is nullish.
 */
async function serializeBody(body: BodyInit | null): Promise<string | null> {
  if (body == null) return null;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) {
    return new TextDecoder().decode(body);
  }
  if (body instanceof Blob) {
    return await body.text();
  }
  if (body instanceof ReadableStream) {
    return await new Response(body).text();
  }
  if (body instanceof FormData) {
    // FormData can't be cleanly serialized to a string; convert to URL-encoded
    return new URLSearchParams(body as unknown as Record<string, string>)
      .toString();
  }
  return String(body);
}

function headersToRecord(h?: HeadersInit): Record<string, string> {
  return Object.fromEntries(new Headers(h).entries());
}

/**
 * Replace `globalThis.fetch` with a proxy that routes requests through
 * the host process via Comlink.
 *
 * This is necessary because sandboxed workers have `net: false`. All
 * outbound HTTP requests are serialized and sent to the host, which
 * validates URLs for SSRF protection before executing the real fetch.
 *
 * @param hostApi - The Comlink remote proxy to the host's {@linkcode HostApi}.
 */
function installFetchProxy(hostApi: Comlink.Remote<HostApi>): void {
  globalThis.fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    let url: string;
    let method: string;
    let headers: Record<string, string>;
    let body: string | null;

    if (input instanceof Request) {
      url = input.url;
      method = init?.method ?? input.method;
      headers = headersToRecord(init?.headers ?? input.headers);
      body = init?.body != null
        ? await serializeBody(init.body)
        : input.body != null
        ? await input.text()
        : null;
    } else {
      url = String(input);
      method = init?.method ?? "GET";
      headers = headersToRecord(init?.headers);
      body = init?.body != null ? await serializeBody(init.body) : null;
    }

    const result = await withTimeout(
      hostApi.fetch({ url, method, headers, body }),
      FETCH_TIMEOUT_MS,
    );

    return new Response(result.body, {
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
    });
  };
}

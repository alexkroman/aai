// Copyright 2025 the AAI authors. MIT license.
import * as log from "@std/log";
import type { PlatformConfig } from "./config.ts";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { ExecuteTool } from "./_worker_entry.ts";
import { createSttConnection, type SttConnection } from "./stt.ts";
import type { TtsConnection } from "./tts.ts";
import { createRimeTtsConnection } from "./tts_rime.ts";
import { createCartesiaTtsConnection } from "./tts_cartesia.ts";
import { createGatewayModel } from "./provider_gateway.ts";
import { getBuiltinVercelTools, type VectorCtx } from "./builtin_tools.ts";
import { executeTurn, type TurnResult } from "./turn_handler.ts";
import type { STTConfig, TTSConfig } from "./types.ts";
import type { AgentConfig, ToolSchema } from "@aai/core/types";
import type { WorkerApi } from "./_worker_entry.ts";
import { HOOK_TIMEOUT_MS } from "@aai/core/protocol";
import type { ClientSink, TurnConfig } from "@aai/core/protocol";
import { buildSystemPrompt } from "./system_prompt.ts";
import {
  type CoreMessage,
  jsonSchema,
  type LanguageModelV1,
  type StepResult,
  tool as vercelTool,
  type ToolExecutionOptions,
  type ToolSet,
} from "ai";
import type { Message } from "@aai/sdk/types";
import * as metrics from "./metrics.ts";

/**
 * Extract a useful error message from LLM/API errors.
 * The Vercel AI SDK throws `APICallError` with a generic `.message` (e.g.
 * "Bad Request") but includes the full API response in `.responseBody`.
 */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  // deno-lint-ignore no-explicit-any
  const apiErr = err as any;

  const parts: string[] = [err.message];

  // Add status code if present
  if (typeof apiErr.statusCode === "number") {
    parts[0] = `${err.message} (HTTP ${apiErr.statusCode})`;
  }

  // Vercel AI SDK APICallError includes responseBody with the provider's
  // error detail (e.g. Anthropic's {"error":{"message":"..."}}).
  if (typeof apiErr.responseBody === "string" && apiErr.responseBody) {
    try {
      const body = JSON.parse(apiErr.responseBody);
      const detail = body?.error?.message ?? body?.message;
      if (typeof detail === "string" && detail) {
        parts.push(detail);
      } else {
        // Include full JSON if no known error field
        parts.push(apiErr.responseBody.slice(0, 500));
      }
    } catch {
      // Not JSON — include raw body (truncated)
      const raw = apiErr.responseBody.slice(0, 500);
      if (raw !== err.message) parts.push(raw);
    }
  }

  // Include the URL that failed
  if (typeof apiErr.url === "string") {
    parts.push(`url=${apiErr.url}`);
  }

  // Include parsed data if the SDK extracted it
  if (apiErr.data != null) {
    try {
      const d = typeof apiErr.data === "string"
        ? apiErr.data
        : JSON.stringify(apiErr.data);
      parts.push(`data=${d.slice(0, 500)}`);
    } catch { /* ignore */ }
  }

  // Fall back to nested cause
  if (
    parts.length === 1 && err.cause instanceof Error &&
    err.cause.message !== err.message
  ) {
    parts.push(err.cause.message);
  }

  return parts.join(" — ");
}

/** Configuration options for creating a new session. */
export type SessionOptions = {
  /** Unique session identifier. */
  id: string;
  /** Agent slug this session belongs to. */
  agent: string;
  /** Typed sink for pushing events to the client. */
  client: ClientSink;
  /** The agent's configuration from `defineAgent()`. */
  agentConfig: AgentConfig;
  /** JSON schemas for agent-defined tools. */
  toolSchemas: readonly ToolSchema[];
  /** Platform-level configuration (API keys, model, STT/TTS settings). */
  platformConfig: PlatformConfig;
  /** Function to execute a tool call in the agent worker. */
  executeTool: ExecuteTool;
  /** Environment variables available to the agent. */
  env?: Record<string, string | undefined>;
  /** Factory to lazily obtain the worker API (spawns worker on first call). */
  getWorkerApi?: () => Promise<WorkerApi>;
  /** When true, suppresses the initial greeting (used for resumed sessions). */
  skipGreeting?: boolean;
  /** Override the default STT connection factory (used in tests). */
  createStt?: (apiKey: string, config: STTConfig) => SttConnection;
  /** Override the default TTS connection factory (used in tests). */
  createTts?: (config: TTSConfig) => TtsConnection;
  /** Override the LLM model (used in tests). */
  model?: LanguageModelV1 | undefined;
  /** Vector store context for the built-in vector_search tool. */
  vectorCtx?: VectorCtx | undefined;
};

const ConnState = {
  Idle: "Idle",
  Starting: "Starting",
  Ready: "Ready",
  Stopped: "Stopped",
} as const;
type ConnState = (typeof ConnState)[keyof typeof ConnState];

const AgentState = {
  WaitingForAudio: "WaitingForAudio",
  Listening: "Listening",
  Processing: "Processing",
} as const;
type AgentState = (typeof AgentState)[keyof typeof AgentState];

/** A voice session managing the STT -> LLM -> TTS pipeline for one connection. */
export type Session = {
  /** Initializes the session and connects to STT. */
  start(): Promise<void>;
  /** Gracefully stops the session, aborting any in-flight turn and closing STT/TTS. */
  stop(): Promise<void>;
  /** Feeds raw PCM audio data from the client into the STT stream. */
  onAudio(data: Uint8Array): void;
  /** Signals that the client's audio pipeline is ready (triggers pending greeting). */
  onAudioReady(): void;
  /** Cancels the current in-flight turn and clears the STT buffer. */
  onCancel(): void;
  /** Resets the conversation history and replays the greeting if configured. */
  onReset(): void;
  /** Restores prior conversation history for a resumed session. */
  onHistory(
    incoming: readonly { role: "user" | "assistant"; text: string }[],
  ): void;
  /** Returns a promise that resolves when the current turn completes. */
  waitForTurn(): Promise<void>;
};

/**
 * Creates a new voice session that wires STT, LLM, and TTS together.
 *
 * The session manages the full lifecycle: connecting to STT, processing
 * user speech into turns, running the agentic LLM loop, synthesizing
 * the response via TTS, and streaming audio back to the client.
 *
 * @param opts - Session configuration including transport, agent config, and tool schemas.
 * @returns A {@linkcode Session} object for controlling the session lifecycle.
 */
export function createSession(opts: SessionOptions): Session {
  let conn: ConnState = ConnState.Idle;
  let agent: AgentState = AgentState.WaitingForAudio;

  let stt: SttConnection | null = null;
  let turnAbort: AbortController | null = null;
  let turnPromise: Promise<void> | null = null;
  let audioFrameCount = 0;
  let pendingGreeting: string | null = null;
  let messages: CoreMessage[] = [];
  let cachedWorkerApi: WorkerApi | undefined;
  /** Resolves turn config from the worker (maxSteps + activeTools) per turn. */
  async function resolveTurnConfigFromWorker(): Promise<TurnConfig | null> {
    if (!getWorkerApi) return null;
    try {
      cachedWorkerApi ??= await getWorkerApi();
      return await cachedWorkerApi.resolveTurnConfig(id, HOOK_TIMEOUT_MS);
    } catch (err: unknown) {
      log.warn("resolveTurnConfig failed, using defaults", { err });
      return null;
    }
  }

  const sessionAbort = new AbortController();

  const id = opts.id;
  const agentSlug = opts.agent;
  const client = opts.client;
  const agentLabel = { agent: opts.agent };
  const env = { ...opts.env };
  const getWorkerApi = opts.getWorkerApi;
  const agentConfig = opts.skipGreeting
    ? { ...opts.agentConfig, greeting: "" }
    : opts.agentConfig;

  const config: PlatformConfig = {
    ...opts.platformConfig,
    sttConfig: {
      ...opts.platformConfig.sttConfig,
      ...(agentConfig.sttPrompt ? { sttPrompt: agentConfig.sttPrompt } : {}),
    },
    ttsConfig: {
      ...opts.platformConfig.ttsConfig,
      ...(agentConfig.voice ? { voice: agentConfig.voice } : {}),
    },
  };

  const doCreateStt = opts.createStt ?? createSttConnection;

  const tts = (() => {
    if (opts.createTts) return opts.createTts(config.ttsConfig);
    switch (config.ttsConfig.provider) {
      case "rime":
        return createRimeTtsConnection(config.ttsConfig);
      case "cartesia":
        return createCartesiaTtsConnection(config.ttsConfig);
      default:
        throw new Error(
          `Unknown TTS provider: ${
            (config.ttsConfig as { provider: string }).provider
          }`,
        );
    }
  })();
  tts.warmup();

  const model = opts.model ?? (() => {
    if (config.anthropicApiKey) {
      const anthropic = createAnthropic({ apiKey: config.anthropicApiKey });
      return anthropic(config.model);
    }
    return createGatewayModel({
      apiKey: config.apiKey,
      model: config.model,
      gatewayBase: config.llmGatewayBase,
    });
  })();

  const hasTools = opts.toolSchemas.length > 0 ||
    (agentConfig.builtinTools?.length ?? 0) > 0;
  const systemPrompt = buildSystemPrompt(agentConfig, {
    hasTools,
    voice: true,
  });

  const tools: ToolSet = getBuiltinVercelTools(
    agentConfig.builtinTools ?? [],
    { env, vectorCtx: opts.vectorCtx },
  );
  for (const schema of opts.toolSchemas) {
    // Skip schemas for builtin tools — they already have host-side execute
    if (schema.name in tools) continue;
    tools[schema.name] = vercelTool({
      description: schema.description,
      parameters: jsonSchema(schema.parameters),
      execute: async (args: unknown, _options: ToolExecutionOptions) => {
        const msgs: Message[] = [];
        for (const m of messages) {
          if (
            typeof m.content === "string" &&
            (m.role === "user" || m.role === "assistant")
          ) {
            msgs.push({ role: m.role, content: m.content });
          }
        }
        return await opts.executeTool(
          schema.name,
          args as Record<string, unknown>,
          id,
          msgs,
        );
      },
    });
  }

  /** Safely call a method on the client sink, ignoring errors if closed. */
  function trySend(fn: () => void): void {
    try {
      if (client.open) fn();
    } catch { /* connection closed between check and send */ }
  }

  /** Stream text through TTS and send audio chunks to the client. */
  async function streamTts(
    ttsConn: TtsConnection,
    text: string | AsyncIterable<string>,
    signal: AbortSignal,
    callbacks?: import("./tts.ts").SynthesizeCallbacks,
  ): Promise<void> {
    await ttsConn.synthesizeStream(
      text,
      (chunk) => {
        trySend(() => client.playAudioChunk(chunk));
      },
      signal,
      callbacks,
    );
    trySend(() => client.playAudioDone());
  }

  async function callHook(
    name: string,
    fn: (api: WorkerApi) => Promise<void>,
  ): Promise<void> {
    if (!getWorkerApi) return;
    try {
      cachedWorkerApi ??= await getWorkerApi();
      await fn(cachedWorkerApi);
    } catch (err: unknown) {
      log.error(`${name} hook failed`, { err });
    }
  }

  async function connectStt(): Promise<void> {
    try {
      const handle = doCreateStt(config.apiKey, config.sttConfig);
      await handle.connect();

      handle.onSpeechStarted = () => {
        trySend(() => client.event({ type: "speech_started" }));
      };

      handle.onTranscript = ({ text, isFinal, turnOrder }) => {
        log.info("transcript", { text, isFinal, turnOrder });
        if (isFinal) {
          trySend(() =>
            client.event(
              turnOrder !== undefined
                ? { type: "transcript", text, isFinal: true, turnOrder }
                : { type: "transcript", text, isFinal: true },
            )
          );
        } else {
          trySend(() =>
            client.event({ type: "transcript", text, isFinal: false })
          );
        }
      };

      handle.onTurn = ({ text, turnOrder }) => {
        log.info("turn", { text, turnOrder });
        const prev = turnPromise;
        const next: Promise<void> = (async () => {
          try {
            await prev;
          } catch (e) {
            log.warn("previous turn failed", e);
          }
          await handleTurn(text, turnOrder);
        })().finally(() => {
          if (turnPromise === next) turnPromise = null;
        });
        turnPromise = next;
      };

      handle.onError = (err) => {
        log.error("STT error:", err.message);
        trySend(() =>
          client.event({
            type: "error",
            code: "stt",
            message: err.message,
          })
        );
      };

      handle.onClose = async () => {
        log.info("STT closed");
        stt = null;
        if (!sessionAbort.signal.aborted) {
          log.info("Attempting STT reconnect");
          try {
            await connectStt();
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            log.error("STT reconnect failed", { cause: err });
            trySend(() =>
              client.event({
                type: "error",
                code: "stt",
                message: msg,
              })
            );
          }
        }
      };

      stt = handle;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("STT connect failed", { cause: err });
      trySend(() => client.event({ type: "error", code: "stt", message: msg }));
    }
  }

  function cancelInflight(): void {
    turnAbort?.abort();
    turnAbort = null;
  }

  async function handleTurn(text: string, turnOrder?: number): Promise<void> {
    // Start config resolution immediately — overlaps with previous-turn drain
    const configPromise = resolveTurnConfigFromWorker();

    cancelInflight();
    agent = AgentState.Processing;

    metrics.turnsTotal.inc(agentLabel);
    const turnStart = performance.now();

    trySend(() =>
      client.event(
        turnOrder !== undefined
          ? { type: "turn", text, turnOrder }
          : { type: "turn", text },
      )
    );

    callHook("onTurn", (api) => api.onTurn(id, text, HOOK_TIMEOUT_MS));

    const abort = new AbortController();
    turnAbort = abort;
    const signal = AbortSignal.any([sessionAbort.signal, abort.signal]);
    let turn: TurnResult | null = null;
    let toolForward: Promise<void> | null = null;

    try {
      let maxSteps = agentConfig.maxSteps;
      let activeTools: string[] | undefined = agentConfig.activeTools
        ? [...agentConfig.activeTools]
        : undefined;

      const resolved = await configPromise;
      if (resolved) {
        if (maxSteps === undefined && resolved.maxSteps !== undefined) {
          maxSteps = resolved.maxSteps;
        }
        if (resolved.activeTools !== undefined) {
          activeTools = resolved.activeTools;
        }
      }

      turn = executeTurn(text, {
        agent: agentSlug,
        model: model!,
        system: systemPrompt,
        messages,
        tools,
        signal,
        maxSteps,
        toolChoice: agentConfig.toolChoice,
        activeTools,
        onStep: getWorkerApi
          ? (step: StepResult<ToolSet>) => {
            const stepInfo = {
              stepNumber: step.stepType === "initial" ? 0 : -1,
              toolCalls: (step.toolCalls ?? []).map((tc) => ({
                toolName: tc.toolName,
                args: tc.args as Record<string, unknown>,
              })),
              text: step.text ?? "",
            };
            // Fire-and-forget — onStep is informational, don't block the turn
            callHook("onStep", (api) =>
              api.onStep(id, stepInfo, HOOK_TIMEOUT_MS));
          }
          : undefined,
      });

      // Forward tool events to client in parallel with TTS streaming
      toolForward = (async () => {
        for await (const evt of turn.toolEvents) {
          if (signal.aborted) break;
          trySend(() =>
            client.event(
              evt.kind === "start"
                ? {
                  type: "tool_call_start",
                  toolCallId: evt.toolCallId,
                  toolName: evt.toolName,
                  args: evt.args,
                }
                : {
                  type: "tool_call_done",
                  toolCallId: evt.toolCallId,
                  result: evt.result,
                },
            )
          );
        }
      })();

      // TTS callbacks: accumulate spoken text and forward word timestamps
      let spokenText = "";
      const ttsCallbacks: import("./tts.ts").SynthesizeCallbacks = {
        onText: (chunk: string) => {
          spokenText += chunk;
        },
        onWords: (words) => {
          trySend(() => client.event({ type: "words", words }));
        },
      };

      if (tts) {
        await streamTts(tts, turn.textStream, signal, ttsCallbacks);
      } else {
        for await (const chunk of turn.textStream) {
          if (chunk) spokenText += chunk;
        }
      }

      if (signal.aborted) return;

      messages.push({ role: "user", content: text });
      messages.push({
        role: "assistant",
        content: spokenText || "Sorry, I couldn't generate a response.",
      });

      if (!tts) {
        trySend(() => client.event({ type: "tts_done" }));
      }
    } catch (err: unknown) {
      if (signal.aborted) return;
      const msg = describeError(err);
      log.error(
        `Turn failed: ${msg}`,
        err instanceof Error ? { cause: err } : undefined,
      );
      metrics.errorsTotal.inc({ ...agentLabel, component: "turn" });
      trySend(() => client.event({ type: "error", code: "llm", message: msg }));
    } finally {
      const settled = [turn?.consume(), toolForward].filter(Boolean);
      if (settled.length) await Promise.allSettled(settled);
      if (turnAbort === abort) turnAbort = null;
      metrics.turnDuration.observe(
        (performance.now() - turnStart) / 1000,
        agentLabel,
      );
      if (agent === AgentState.Processing) {
        agent = AgentState.Listening;
      }
    }
  }

  /** Stream text through TTS with word timing events — used for greetings. */
  function streamGreeting(text: string): void {
    if (!tts) return;
    const ttsConn = tts;
    const abort = new AbortController();
    turnAbort = abort;
    const signal = AbortSignal.any([sessionAbort.signal, abort.signal]);
    const callbacks: import("./tts.ts").SynthesizeCallbacks = {
      onWords: (words) => {
        trySend(() => client.event({ type: "words", words }));
      },
    };
    const p: Promise<void> = (async () => {
      try {
        await streamTts(ttsConn, text, signal, callbacks);
      } catch (err: unknown) {
        if (signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        log.error("TTS failed", { cause: err });
        trySend(() =>
          client.event({ type: "error", code: "tts", message: msg })
        );
      } finally {
        if (turnAbort === abort) turnAbort = null;
      }
    })().finally(() => {
      if (turnPromise === p) turnPromise = null;
    });
    turnPromise = p;
  }

  return {
    async start(): Promise<void> {
      if (conn !== ConnState.Idle) return;
      conn = ConnState.Starting;

      metrics.sessionsTotal.inc(agentLabel);
      metrics.sessionsActive.inc(agentLabel);

      if (agentConfig.greeting) {
        pendingGreeting = agentConfig.greeting;
      }

      callHook("onConnect", (api) => api.onConnect(id, HOOK_TIMEOUT_MS));

      // Pre-warm worker (fire-and-forget, populates cachedWorkerApi)
      if (getWorkerApi) {
        getWorkerApi().then((api) => {
          cachedWorkerApi = api;
        }).catch((err) => {
          log.warn("Worker pre-warm failed", { cause: err });
        });
      }

      // Fire-and-forget — stt?.send() in onAudio no-ops while null
      connectStt();

      conn = ConnState.Ready;
    },

    async stop(): Promise<void> {
      if (conn === ConnState.Stopped) return;
      conn = ConnState.Stopped;
      sessionAbort.abort();
      metrics.sessionsActive.dec(agentLabel);

      const pending = turnPromise;
      if (pending) await pending;

      stt?.close();
      tts.close();

      callHook("onDisconnect", (api) => api.onDisconnect(id, HOOK_TIMEOUT_MS));
    },

    onAudio(data: Uint8Array): void {
      audioFrameCount++;
      if (audioFrameCount <= 3) {
        log.debug("audio frame", {
          frame: audioFrameCount,
          bytes: data.length,
        });
      }
      stt?.send(data);
    },

    onAudioReady(): void {
      if (agent !== AgentState.WaitingForAudio) return;
      agent = AgentState.Listening;

      if (pendingGreeting) {
        streamGreeting(pendingGreeting);
        pendingGreeting = null;
      }
    },

    onCancel(): void {
      cancelInflight();
      stt?.clear();
      trySend(() => client.event({ type: "cancelled" }));

      if (agent === AgentState.Processing) {
        agent = AgentState.Listening;
      }
    },

    onReset(): void {
      cancelInflight();
      stt?.clear();
      messages = [];
      agent = AgentState.Listening;
      trySend(() => client.event({ type: "reset" }));

      if (agentConfig.greeting) {
        streamGreeting(agentConfig.greeting);
      }
    },

    onHistory(
      incoming: readonly { role: "user" | "assistant"; text: string }[],
    ): void {
      for (const msg of incoming) {
        messages.push({ role: msg.role, content: msg.text });
      }
      log.info("Restored conversation history", {
        count: incoming.length,
      });
    },

    waitForTurn(): Promise<void> {
      return turnPromise ?? Promise.resolve();
    },
  };
}

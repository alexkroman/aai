import type { PlatformConfig } from "./config.ts";
import { createModel } from "./model.ts";
import type { ExecuteTool } from "@aai/core/worker-entry";
import {
  connectStt,
  type SttHandle,
  type SttTranscriptDetail,
  type SttTurnDetail,
} from "./stt.ts";
import { createTtsClient } from "./tts.ts";
import { getBuiltinVercelTools } from "./builtin_tools.ts";
import { executeTurn } from "./turn_handler.ts";
import type { STTConfig } from "./types.ts";
import type { AgentConfig } from "@aai/sdk/types";
import type { BuiltinTool, ToolSchema } from "@aai/sdk/schema";
import type { WorkerApi } from "@aai/core/worker-entry";
import { buildSystemPrompt } from "./system_prompt.ts";
import {
  type CoreAssistantMessage,
  type CoreMessage,
  type CoreUserMessage,
  jsonSchema,
  type StepResult,
  tool as vercelTool,
  type ToolExecutionOptions,
  type ToolSet,
} from "ai";
import type { Message } from "@aai/sdk/types";
import * as metrics from "./metrics.ts";
import { AUDIO_FORMAT, PROTOCOL_VERSION } from "@aai/core/protocol";

export type SessionTransport = {
  send(data: string | ArrayBuffer | Uint8Array): void;
  readonly readyState: 0 | 1 | 2 | 3;
};

export type TtsClient = {
  warmup(): void;
  synthesizeStream(
    chunks: string | AsyncIterable<string>,
    onAudio: (chunk: Uint8Array) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  close(): void;
};

export type SessionOptions = {
  id: string;
  agent: string;
  transport: SessionTransport;
  agentConfig: AgentConfig;
  toolSchemas: ToolSchema[];
  platformConfig: PlatformConfig;
  executeTool: ExecuteTool;
  env?: Record<string, string | undefined>;
  getWorkerApi?: () => Promise<WorkerApi>;
  skipGreeting?: boolean;
  connectStt?: (
    apiKey: string,
    config: STTConfig,
  ) => Promise<SttHandle>;
  createTtsClient?: (
    config: Parameters<typeof createTtsClient>[0],
  ) => TtsClient;
};

export type Session = {
  start(): Promise<void>;
  stop(): Promise<void>;
  onAudio(data: Uint8Array): void;
  onAudioReady(): void;
  onCancel(): void;
  onReset(): void;
  onHistory(messages: { role: "user" | "assistant"; text: string }[]): void;
  waitForTurn(): Promise<void>;
};

function coreMessagesToSimple(msgs: CoreMessage[]): Message[] {
  const result: Message[] = [];
  for (const m of msgs) {
    if (typeof m.content === "string") {
      result.push({ role: m.role as Message["role"], content: m.content });
    }
  }
  return result;
}

function buildVercelTools(
  customSchemas: ToolSchema[],
  builtinNames: readonly BuiltinTool[],
  executeTool: ExecuteTool,
  sessionId: string,
  env: Record<string, string | undefined>,
  getMessages: () => CoreMessage[],
): ToolSet {
  // Builtin tools (Zod schemas, some with execute, some without)
  const tools = getBuiltinVercelTools(builtinNames, env);

  // Custom tools from the worker (JSON schemas, execute via RPC)
  for (const schema of customSchemas) {
    tools[schema.name] = vercelTool({
      description: schema.description,
      parameters: jsonSchema(schema.parameters),
      execute: async (args: unknown, _options: ToolExecutionOptions) => {
        const result = await executeTool(
          schema.name,
          args as Record<string, unknown>,
          sessionId,
          coreMessagesToSimple(getMessages()),
        );
        return result;
      },
    });
  }

  return tools;
}

export function createSession(opts: SessionOptions): Session {
  const {
    id,
    agent,
    transport: ws,
    toolSchemas,
    platformConfig,
    executeTool,
    getWorkerApi,
  } = opts;
  const agentLabel = { agent };

  const slotEnv = opts.env as Record<string, string> | undefined;
  let cachedWorkerApi: WorkerApi | undefined;
  async function invokeHook(
    hook: string,
    extra?: {
      text?: string;
      error?: string;
      step?: {
        stepNumber: number;
        toolCalls: { toolName: string; args: Record<string, unknown> }[];
        text: string;
      };
    },
  ): Promise<void> {
    if (!getWorkerApi) return;
    try {
      cachedWorkerApi ??= await getWorkerApi();
      await cachedWorkerApi.invokeHook(hook, id, extra, 5_000, slotEnv);
    } catch (err: unknown) {
      console.error(`${hook} hook failed`, { err });
    }
  }

  const agentConfig = opts.skipGreeting
    ? { ...opts.agentConfig, greeting: "" }
    : opts.agentConfig;

  const env: Record<string, string | undefined> = { ...opts.env };
  const config: PlatformConfig = {
    ...platformConfig,
    sttConfig: {
      ...platformConfig.sttConfig,
      ...(agentConfig.sttPrompt ? { sttPrompt: agentConfig.sttPrompt } : {}),
    },
    ttsConfig: {
      ...platformConfig.ttsConfig,
      ...(agentConfig.voice ? { voice: agentConfig.voice } : {}),
    },
  };

  const doConnectStt = opts.connectStt ?? connectStt;
  const tts: TtsClient = (opts.createTtsClient ?? createTtsClient)(
    config.ttsConfig,
  );
  tts.warmup();

  // Create the Vercel AI model with gateway middleware
  const model = createModel({
    apiKey: config.apiKey,
    model: config.model,
    gatewayBase: config.llmGatewayBase,
  });

  // Build system prompt
  const hasTools = toolSchemas.length > 0 ||
    (agentConfig.builtinTools?.length ?? 0) > 0;
  const systemPrompt = buildSystemPrompt(agentConfig, hasTools, {
    voice: true,
  });

  // Build Vercel tool set (getMessages closure provides current conversation)
  const getMessages = () => messages;
  const tools = buildVercelTools(
    toolSchemas,
    agentConfig.builtinTools ?? [],
    executeTool,
    id,
    env,
    getMessages,
  );

  let stt: SttHandle | null = null;
  const sessionAbort = new AbortController();
  let turnAbort: AbortController | null = null;
  let turnPromise: Promise<void> | null = null;
  let audioFrameCount = 0;
  let pendingGreeting: string | null = null;
  let messages: CoreMessage[] = [];

  function trySend(data: string | Uint8Array): void {
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    } catch { /* ws closed between check and send */ }
  }

  function trySendJson(data: Record<string, unknown>): void {
    trySend(JSON.stringify(data));
  }

  function cancelInflight(): void {
    turnAbort?.abort();
    turnAbort = null;
  }

  async function doConnectSttWithEvents(): Promise<void> {
    try {
      const handle = await doConnectStt(config.apiKey, config.sttConfig);

      handle.addEventListener(
        "transcript",
        ((
          e: CustomEvent<SttTranscriptDetail>,
        ) => {
          const { text, isFinal, turnOrder } = e.detail;
          console.info("transcript", { text, isFinal, turnOrder });
          if (isFinal) {
            trySendJson({
              type: "final_transcript",
              text,
              ...(turnOrder !== undefined ? { turn_order: turnOrder } : {}),
            });
          } else {
            trySendJson({ type: "partial_transcript", text });
          }
        }) as EventListener,
      );

      handle.addEventListener(
        "turn",
        ((e: CustomEvent<SttTurnDetail>) => {
          const { text, turnOrder } = e.detail;
          console.info("turn", { text, turnOrder });
          const prev = turnPromise;
          const next = (prev ?? Promise.resolve())
            .catch(() => {})
            .then(() => handleTurn(text, turnOrder))
            .finally(() => {
              if (turnPromise === next) turnPromise = null;
            });
          turnPromise = next;
        }) as EventListener,
      );

      handle.addEventListener(
        "termination",
        ((
          e: CustomEvent<{ audioDuration: number; sessionDuration: number }>,
        ) => {
          const { audioDuration, sessionDuration } = e.detail;
          console.info("STT termination", { audioDuration, sessionDuration });
        }) as EventListener,
      );

      handle.addEventListener(
        "error",
        ((
          e: CustomEvent<{ error: Error }>,
        ) => {
          const err = e.detail.error;
          console.error("STT error:", err.message);
          trySendJson({
            type: "error",
            message: err.message,
          });
        }) as EventListener,
      );

      handle.addEventListener("close", () => {
        console.info("STT closed");
        stt = null;
        if (!sessionAbort.signal.aborted) {
          console.info("Attempting STT reconnect");
          doConnectSttWithEvents().catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error("STT reconnect failed:", msg);
            trySendJson({ type: "error", message: msg });
          });
        }
      });

      stt = handle;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("STT connect failed:", msg);
      trySendJson({ type: "error", message: msg });
    }
  }

  async function handleTurn(text: string, turnOrder?: number): Promise<void> {
    cancelInflight();
    metrics.turnsTotal.inc(agentLabel);
    const turnStart = performance.now();

    trySendJson({
      type: "turn",
      text,
      ...(turnOrder !== undefined ? { turn_order: turnOrder } : {}),
    });

    invokeHook("onTurn", { text });

    const abort = new AbortController();
    turnAbort = abort;
    const signal = AbortSignal.any([sessionAbort.signal, abort.signal]);

    try {
      // Resolve dynamic stopWhen if the agent uses a function
      let stopWhen = agentConfig.stopWhen;
      if (stopWhen === undefined && getWorkerApi) {
        try {
          cachedWorkerApi ??= await getWorkerApi();
          const resolved = await cachedWorkerApi.resolveStopWhen(
            id,
            5_000,
            slotEnv,
          );
          if (resolved !== null) stopWhen = resolved;
        } catch (err: unknown) {
          console.warn("resolveStopWhen failed, using default", { err });
        }
      }

      const result = await executeTurn(text, {
        agent,
        model,
        system: systemPrompt,
        messages,
        tools,
        signal,
        stopWhen,
        toolChoice: agentConfig.toolChoice,
        onStep: getWorkerApi
          ? async (step: StepResult<ToolSet>) => {
            const stepInfo = {
              stepNumber: step.stepType === "initial" ? 0 : -1,
              toolCalls: (step.toolCalls ?? []).map((tc) => ({
                toolName: tc.toolName,
                args: tc.args as Record<string, unknown>,
              })),
              text: step.text ?? "",
            };
            await invokeHook("onStep", { step: stepInfo });
          }
          : undefined,
        resolveBeforeStep: getWorkerApi
          ? async (stepNumber: number) => {
            try {
              cachedWorkerApi ??= await getWorkerApi!();
              return await cachedWorkerApi.resolveBeforeStep(
                id,
                stepNumber,
                5_000,
                slotEnv,
              );
            } catch (err: unknown) {
              console.warn("resolveBeforeStep failed", { err });
              return null;
            }
          }
          : undefined,
      });
      if (signal.aborted) return;

      if (result) {
        trySendJson({ type: "chat", text: result });
        await tts.synthesizeStream(
          result,
          (chunk) => trySend(chunk),
          signal,
        );
        if (!signal.aborted) trySendJson({ type: "tts_done" });
      } else {
        trySendJson({ type: "tts_done" });
      }
    } catch (err: unknown) {
      if (signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      // Log full error details for API errors (includes responseBody)
      if (err instanceof Error && "responseBody" in err) {
        console.error("Turn failed:", msg, {
          responseBody: (err as { responseBody?: string }).responseBody,
          statusCode: (err as { statusCode?: number }).statusCode,
        });
      } else {
        console.error("Turn failed:", msg);
      }
      metrics.errorsTotal.inc({ ...agentLabel, component: "turn" });
      trySendJson({ type: "error", message: msg });
    } finally {
      if (turnAbort === abort) turnAbort = null;
      metrics.turnDuration.observe(
        (performance.now() - turnStart) / 1000,
        agentLabel,
      );
    }
  }

  function speakText(text: string): void {
    const abort = new AbortController();
    turnAbort = abort;
    const signal = AbortSignal.any([sessionAbort.signal, abort.signal]);
    const p = tts
      .synthesizeStream(text, (chunk) => trySend(chunk), signal)
      .then(() => {
        if (!signal.aborted) trySendJson({ type: "tts_done" });
      })
      .catch((err: unknown) => {
        if (signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.error("TTS failed:", msg);
        trySendJson({ type: "error", message: msg });
      })
      .finally(() => {
        if (turnAbort === abort) turnAbort = null;
        if (turnPromise === p) turnPromise = null;
      });
    turnPromise = p;
  }

  return {
    async start(): Promise<void> {
      metrics.sessionsTotal.inc(agentLabel);
      metrics.sessionsActive.inc(agentLabel);

      if (agentConfig.greeting) pendingGreeting = agentConfig.greeting;

      invokeHook("onConnect");

      await doConnectSttWithEvents();
      trySendJson({
        type: "ready",
        protocol_version: PROTOCOL_VERSION,
        audio_format: AUDIO_FORMAT,
        sample_rate: config.sttConfig.sampleRate,
        tts_sample_rate: config.ttsConfig.sampleRate,
      });
    },

    async stop(): Promise<void> {
      if (sessionAbort.signal.aborted) return;
      sessionAbort.abort();
      metrics.sessionsActive.dec(agentLabel);
      const pending = turnPromise;
      if (pending) await pending;
      stt?.close();
      tts.close();

      invokeHook("onDisconnect");
    },

    onAudio(data: Uint8Array): void {
      audioFrameCount++;
      if (audioFrameCount <= 3) {
        console.debug("audio frame", {
          frame: audioFrameCount,
          bytes: data.length,
        });
      }
      stt?.send(data);
    },

    onAudioReady(): void {
      if (pendingGreeting) {
        trySendJson({ type: "chat", text: pendingGreeting });
        speakText(pendingGreeting);
        pendingGreeting = null;
      }
    },

    onCancel(): void {
      cancelInflight();
      stt?.clear();
      trySendJson({ type: "cancelled" });
    },

    onReset(): void {
      cancelInflight();
      stt?.clear();
      messages = [];
      trySendJson({ type: "reset" });

      if (agentConfig.greeting) {
        trySendJson({ type: "chat", text: agentConfig.greeting });
        speakText(agentConfig.greeting);
      }
    },

    onHistory(
      incoming: { role: "user" | "assistant"; text: string }[],
    ): void {
      for (const msg of incoming) {
        const coreMsg: CoreUserMessage | CoreAssistantMessage = {
          role: msg.role,
          content: msg.text,
        };
        messages.push(coreMsg);
      }
      console.info("Restored conversation history", {
        count: incoming.length,
      });
    },

    waitForTurn(): Promise<void> {
      return turnPromise ?? Promise.resolve();
    },
  };
}

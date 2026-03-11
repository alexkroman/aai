import type { PlatformConfig } from "./config.ts";
import type { ExecuteTool } from "@aai/core/worker-entry";
import {
  connectS2s,
  type S2sHandle,
  type S2sSessionConfig,
  type S2sToolCall,
  type S2sToolSchema,
} from "./s2s.ts";
import {
  executeBuiltinTool,
  getBuiltinS2sToolSchemas,
} from "./builtin_tools.ts";
import type { AgentConfig } from "@aai/sdk/types";
import type { ToolSchema } from "@aai/sdk/schema";
import type { WorkerApi } from "@aai/core/worker-entry";
import { buildSystemPrompt } from "./system_prompt.ts";
import type { Message } from "@aai/sdk/types";
import * as metrics from "./metrics.ts";
import { AUDIO_FORMAT, PROTOCOL_VERSION } from "@aai/core/protocol";

export type SessionTransport = {
  send(data: string | ArrayBuffer | Uint8Array): void;
  readonly readyState: 0 | 1 | 2 | 3;
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
  connectS2s?: (apiKey: string) => Promise<S2sHandle>;
};

export type Session = {
  start(): Promise<void>;
  stop(): Promise<void>;
  onAudio(data: Uint8Array): void;
  onAudioReady(): void;
  onCancel(): void;
  onReset(): void;
  waitForTurn(): Promise<void>;
};

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

  const agentConfig = opts.agentConfig;

  const env: Record<string, string | undefined> = { ...opts.env };
  const s2sConfig = platformConfig.s2sConfig;

  // Build system prompt
  const hasTools = toolSchemas.length > 0 ||
    (agentConfig.builtinTools?.length ?? 0) > 0;
  const systemPrompt = buildSystemPrompt(agentConfig, hasTools, {
    voice: true,
  });

  // Build S2S tool schemas
  const s2sTools: S2sToolSchema[] = [
    ...getBuiltinS2sToolSchemas(agentConfig.builtinTools ?? []),
    ...toolSchemas.map((ts) => ({
      type: "function" as const,
      name: ts.name,
      description: ts.description,
      parameters: ts.parameters as Record<string, unknown>,
    })),
  ];

  const builtinToolNames = new Set<string>(
    (agentConfig.builtinTools ?? []).map((n) => n),
  );

  let s2s: S2sHandle | null = null;
  const sessionAbort = new AbortController();
  let audioReady = false;
  let toolCallCount = 0;
  let turnPromise: Promise<void> | null = null;
  let conversationMessages: Message[] = [];
  let s2sSessionId: string | null = null;

  function trySend(data: string | Uint8Array): void {
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    } catch { /* ws closed between check and send */ }
  }

  function trySendJson(data: Record<string, unknown>): void {
    trySend(JSON.stringify(data));
  }

  async function handleToolCall(detail: S2sToolCall): Promise<void> {
    const { call_id, name, args: argsStr } = detail;
    metrics.toolDuration.observe(0, { agent, tool: name });

    // Resolve maxSteps
    let maxSteps = agentConfig.maxSteps;
    if (maxSteps === undefined && getWorkerApi) {
      try {
        cachedWorkerApi ??= await getWorkerApi();
        const resolved = await cachedWorkerApi.resolveMaxSteps(
          id,
          5_000,
          slotEnv,
        );
        if (resolved !== null) maxSteps = resolved;
      } catch (err: unknown) {
        console.warn("resolveMaxSteps failed, using default", { err });
      }
    }

    toolCallCount++;

    // Check maxSteps
    if (maxSteps !== undefined && toolCallCount > maxSteps) {
      console.info("maxSteps exceeded, refusing tool call", {
        toolCallCount,
        maxSteps,
      });
      s2s?.sendToolResult(
        call_id,
        "Maximum tool steps reached. Please respond to the user now.",
      );
      return;
    }

    // Check onBeforeStep activeTools filter
    if (getWorkerApi) {
      try {
        cachedWorkerApi ??= await getWorkerApi();
        const beforeStep = await cachedWorkerApi.resolveBeforeStep(
          id,
          toolCallCount - 1,
          5_000,
          slotEnv,
        );
        if (beforeStep?.activeTools && !beforeStep.activeTools.includes(name)) {
          console.info("Tool filtered by onBeforeStep", { name });
          s2s?.sendToolResult(
            call_id,
            JSON.stringify({
              error: `Tool "${name}" is not available at this step.`,
            }),
          );
          return;
        }
      } catch (err: unknown) {
        console.warn("resolveBeforeStep failed", { err });
      }
    }

    // Fire onStep hook
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = JSON.parse(argsStr);
    } catch { /* use empty */ }

    invokeHook("onStep", {
      step: {
        stepNumber: toolCallCount - 1,
        toolCalls: [{ toolName: name, args: parsedArgs }],
        text: "",
      },
    });

    console.info("tool call", { tool: name, agent });

    // Execute
    let result: string;
    try {
      if (builtinToolNames.has(name)) {
        result = await executeBuiltinTool(name, parsedArgs, env);
      } else {
        result = await executeTool(
          name,
          parsedArgs,
          id,
          conversationMessages,
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Tool execution failed", { tool: name, error: msg });
      result = JSON.stringify({ error: msg });
    }

    s2s?.sendToolResult(call_id, result);
  }

  const doConnectS2s = opts.connectS2s ??
    ((apiKey: string) => connectS2s(apiKey, s2sConfig));

  async function connectAndSetup(): Promise<void> {
    try {
      const handle = await doConnectS2s(platformConfig.apiKey);

      // If we have a previous session_id, attempt to resume
      if (s2sSessionId) {
        console.info("Attempting S2S session resume", {
          session_id: s2sSessionId,
        });
        handle.resumeSession(s2sSessionId);
      }

      handle.addEventListener(
        "ready",
        ((e: CustomEvent<{ session_id: string }>) => {
          s2sSessionId = e.detail.session_id;
          console.info("S2S session ready", { session_id: s2sSessionId });
          // Send session config
          const sessionConfig: S2sSessionConfig = {
            system_prompt: systemPrompt,
            tools: s2sTools,
            input_sample_rate: s2sConfig.inputSampleRate,
            output_sample_rate: s2sConfig.outputSampleRate,
          };
          if (agentConfig.voice) {
            sessionConfig.voice = agentConfig.voice;
          }
          handle.updateSession(sessionConfig);
        }) as EventListener,
      );

      handle.addEventListener(
        "session_expired",
        (() => {
          console.info("S2S session expired, reconnecting fresh");
          s2sSessionId = null;
          handle.close();
          // close handler will trigger reconnect with no session_id
        }) as EventListener,
      );

      handle.addEventListener(
        "user_transcript",
        ((e: CustomEvent<{ item_id: string; text: string }>) => {
          const { text } = e.detail;
          console.info("user transcript", { text });
          trySendJson({ type: "final_transcript", text });
          conversationMessages.push({ role: "user", content: text });
          invokeHook("onTurn", { text });
        }) as EventListener,
      );

      handle.addEventListener(
        "reply_started",
        (() => {
          toolCallCount = 0;
        }) as EventListener,
      );

      handle.addEventListener(
        "audio",
        ((e: CustomEvent<{ reply_id: string; audio: Uint8Array }>) => {
          trySend(e.detail.audio);
        }) as EventListener,
      );

      handle.addEventListener(
        "agent_transcript",
        ((
          e: CustomEvent<{
            reply_id: string;
            item_id: string;
            text: string;
          }>,
        ) => {
          const { text } = e.detail;
          trySendJson({ type: "chat", text });
          conversationMessages.push({ role: "assistant", content: text });
        }) as EventListener,
      );

      handle.addEventListener(
        "tool_call",
        ((e: CustomEvent<S2sToolCall>) => {
          const p = handleToolCall(e.detail).catch((err: unknown) => {
            console.error("Tool call handler failed", { err });
          });
          // Track as pending work
          const prev = turnPromise;
          turnPromise = (prev ?? Promise.resolve()).then(() => p).finally(
            () => {
              if (turnPromise === turnPromise) turnPromise = null;
            },
          );
        }) as EventListener,
      );

      handle.addEventListener(
        "reply_done",
        ((e: CustomEvent<{ reply_id: string; status: string }>) => {
          const { status } = e.detail;
          if (status === "interrupted") {
            console.info("Reply interrupted (barge-in)");
            trySendJson({ type: "cancelled" });
          } else {
            trySendJson({ type: "tts_done" });
          }
        }) as EventListener,
      );

      handle.addEventListener(
        "error",
        ((e: CustomEvent<{ code: string; message: string }>) => {
          const { code, message } = e.detail;
          console.error("S2S error:", { code, message });
          trySendJson({ type: "error", message });
        }) as EventListener,
      );

      handle.addEventListener("close", () => {
        console.info("S2S closed");
        s2s = null;
        if (!sessionAbort.signal.aborted) {
          console.info("Attempting S2S reconnect");
          connectAndSetup().catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error("S2S reconnect failed:", msg);
            trySendJson({ type: "error", message: msg });
          });
        }
      });

      s2s = handle;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("S2S connect failed:", msg);
      trySendJson({ type: "error", message: msg });
    }
  }

  return {
    async start(): Promise<void> {
      metrics.sessionsTotal.inc(agentLabel);
      metrics.sessionsActive.inc(agentLabel);

      invokeHook("onConnect");

      await connectAndSetup();
      trySendJson({
        type: "ready",
        protocol_version: PROTOCOL_VERSION,
        audio_format: AUDIO_FORMAT,
        input_sample_rate: s2sConfig.inputSampleRate,
        output_sample_rate: s2sConfig.outputSampleRate,
      });
    },

    async stop(): Promise<void> {
      if (sessionAbort.signal.aborted) return;
      sessionAbort.abort();
      metrics.sessionsActive.dec(agentLabel);
      const pending = turnPromise;
      if (pending) await pending;
      s2s?.close();

      invokeHook("onDisconnect");
    },

    onAudio(data: Uint8Array): void {
      s2s?.sendAudio(data);
    },

    onAudioReady(): void {
      if (audioReady) return;
      audioReady = true;
      // S2S handles greeting via system_prompt instruction —
      // it will auto-speak on session start. No explicit TTS needed.
    },

    onCancel(): void {
      // S2S handles barge-in natively. Send cancelled to client.
      trySendJson({ type: "cancelled" });
    },

    onReset(): void {
      // Close S2S and reconnect for a fresh session.
      conversationMessages = [];
      toolCallCount = 0;
      s2sSessionId = null; // Don't resume — start fresh
      s2s?.close();
      // Reconnect will happen via the close handler.
      trySendJson({ type: "reset" });
    },

    waitForTurn(): Promise<void> {
      return turnPromise ?? Promise.resolve();
    },
  };
}

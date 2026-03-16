// Copyright 2025 the AAI authors. MIT license.
/**
 * S2S session — relays audio between the client and AssemblyAI's
 * Speech-to-Speech API, intercepting only tool calls for local execution.
 *
 * @module
 */
import * as log from "@std/log";
import type { Session, SessionOptions } from "./session.ts";
import {
  connectS2s,
  type S2sHandle,
  type S2sSessionConfig,
  type S2sToolCall,
  type S2sToolSchema,
} from "./s2s.ts";
import { executeBuiltinTool } from "./builtin_tools.ts";
import { buildSystemPrompt } from "./system_prompt.ts";
import { HOOK_TIMEOUT_MS } from "@aai/core/protocol";
import type { Message } from "@aai/sdk/types";
import type { WorkerApi } from "./_worker_entry.ts";
import * as metrics from "./metrics.ts";

export const _internals = {
  connectS2s,
};

/** Create an S2S-backed session with the same interface as the STT+LLM+TTS session. */
export function createS2sSession(opts: SessionOptions): Session {
  const {
    id,
    agent,
    client,
    toolSchemas,
    platformConfig,
    executeTool,
    getWorkerApi,
    vectorCtx,
  } = opts;

  const agentLabel = { agent };
  const env: Record<string, string | undefined> = { ...opts.env };
  const s2sConfig = platformConfig.s2sConfig;
  const agentConfig = opts.skipGreeting
    ? { ...opts.agentConfig, greeting: "" }
    : opts.agentConfig;

  // Build system prompt
  const hasTools = toolSchemas.length > 0 ||
    (agentConfig.builtinTools?.length ?? 0) > 0;
  const systemPrompt = buildSystemPrompt(agentConfig, {
    hasTools,
    voice: true,
  });

  // toolSchemas already includes both agent-defined and builtin tools
  const s2sTools: S2sToolSchema[] = toolSchemas.map((ts) => ({
    type: "function" as const,
    name: ts.name,
    description: ts.description,
    parameters: ts.parameters as Record<string, unknown>,
  }));
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
  let cachedWorkerApi: WorkerApi | undefined;

  async function resolveTurnConfig(): Promise<
    { maxSteps?: number; activeTools?: string[] } | null
  > {
    if (!getWorkerApi) return null;
    try {
      cachedWorkerApi ??= await getWorkerApi();
      return await cachedWorkerApi.resolveTurnConfig(id, HOOK_TIMEOUT_MS);
    } catch {
      return null;
    }
  }

  async function invokeHook(
    hook: "onConnect" | "onDisconnect" | "onTurn" | "onError" | "onStep",
    ...args: unknown[]
  ): Promise<void> {
    if (!getWorkerApi) return;
    try {
      cachedWorkerApi ??= await getWorkerApi();
      switch (hook) {
        case "onConnect":
          await cachedWorkerApi.onConnect(id, HOOK_TIMEOUT_MS);
          break;
        case "onDisconnect":
          await cachedWorkerApi.onDisconnect(id, HOOK_TIMEOUT_MS);
          break;
        case "onTurn":
          await cachedWorkerApi.onTurn(id, args[0] as string, HOOK_TIMEOUT_MS);
          break;
        case "onError":
          await cachedWorkerApi.onError(
            id,
            args[0] as { message: string },
            HOOK_TIMEOUT_MS,
          );
          break;
        case "onStep":
          await cachedWorkerApi.onStep(
            id,
            args[0] as {
              stepNumber: number;
              toolCalls: { toolName: string; args: Record<string, unknown> }[];
              text: string;
            },
            HOOK_TIMEOUT_MS,
          );
          break;
      }
    } catch (err: unknown) {
      log.warn(`${hook} hook failed`, { err });
    }
  }

  async function handleToolCall(detail: S2sToolCall): Promise<void> {
    const { call_id, name, args: argsStr } = detail;

    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = JSON.parse(argsStr);
    } catch { /* use empty */ }

    // Emit tool_call_start to client
    client.event({
      type: "tool_call_start",
      toolCallId: call_id,
      toolName: name,
      args: parsedArgs,
    });

    // Resolve turn config for maxSteps / activeTools
    const turnConfig = await resolveTurnConfig();
    const maxSteps = turnConfig?.maxSteps ?? agentConfig.maxSteps;

    toolCallCount++;

    // Check maxSteps
    if (maxSteps !== undefined && toolCallCount > maxSteps) {
      log.info("maxSteps exceeded, refusing tool call", {
        toolCallCount,
        maxSteps,
      });
      s2s?.sendToolResult(
        call_id,
        "Maximum tool steps reached. Please respond to the user now.",
      );
      client.event({ type: "tool_call_done", toolCallId: call_id, result: "" });
      return;
    }

    // Check activeTools filter
    if (turnConfig?.activeTools && !turnConfig.activeTools.includes(name)) {
      log.info("Tool filtered by activeTools", { name });
      const errResult = JSON.stringify({
        error: `Tool "${name}" is not available at this step.`,
      });
      s2s?.sendToolResult(call_id, errResult);
      client.event({
        type: "tool_call_done",
        toolCallId: call_id,
        result: errResult,
      });
      return;
    }

    // Fire onStep hook
    invokeHook("onStep", {
      stepNumber: toolCallCount - 1,
      toolCalls: [{ toolName: name, args: parsedArgs }],
      text: "",
    });

    log.info("S2S tool call", { tool: name, call_id, args: parsedArgs, agent });

    // Execute
    let result: string;
    try {
      if (builtinToolNames.has(name)) {
        result = await executeBuiltinTool(name, parsedArgs, { env, vectorCtx });
      } else {
        result = await executeTool(name, parsedArgs, id, conversationMessages);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("Tool execution failed", { tool: name, error: msg });
      result = JSON.stringify({ error: msg });
    }

    log.info("S2S tool result", {
      tool: name,
      call_id,
      resultLength: result.length,
    });
    s2s?.sendToolResult(call_id, result);
    client.event({ type: "tool_call_done", toolCallId: call_id, result });
  }

  async function connectAndSetup(): Promise<void> {
    try {
      const handle = await _internals.connectS2s(
        platformConfig.apiKey,
        s2sConfig,
      );

      // Send session.update immediately on connect — before session.ready.
      if (s2sSessionId) {
        log.info("Attempting S2S session resume", {
          session_id: s2sSessionId,
        });
        handle.resumeSession(s2sSessionId);
      }
      const sessionConfig: S2sSessionConfig = {
        "system_prompt": systemPrompt,
        tools: s2sTools,
      };
      if (agentConfig.voice) sessionConfig.voice = agentConfig.voice;
      if (agentConfig.greeting) sessionConfig.greeting = agentConfig.greeting;
      handle.updateSession(sessionConfig);

      handle.addEventListener(
        "ready",
        ((e: CustomEvent<{ session_id: string }>) => {
          s2sSessionId = e.detail.session_id;
          log.info("S2S session ready", { session_id: s2sSessionId });
        }) as EventListener,
      );

      handle.addEventListener(
        "session_expired",
        (() => {
          log.info("S2S session expired, reconnecting fresh");
          s2sSessionId = null;
          handle.close();
        }) as EventListener,
      );

      handle.addEventListener("speech_started", () => {
        client.event({ type: "speech_started" });
      });

      handle.addEventListener(
        "user_transcript_delta",
        ((e: CustomEvent<{ text: string }>) => {
          client.event({
            type: "transcript",
            text: e.detail.text,
            isFinal: false,
          });
        }) as EventListener,
      );

      handle.addEventListener(
        "user_transcript",
        ((e: CustomEvent<{ item_id: string; text: string }>) => {
          const { text } = e.detail;
          log.info("S2S user transcript", { text });
          client.event({ type: "transcript", text, isFinal: true });
          client.event({ type: "turn", text });
          conversationMessages.push({ role: "user", content: text });
          invokeHook("onTurn", text);
        }) as EventListener,
      );

      handle.addEventListener("reply_started", () => {
        toolCallCount = 0;
      });

      handle.addEventListener(
        "audio",
        ((e: CustomEvent<{ reply_id: string; audio: Uint8Array }>) => {
          client.playAudioChunk(e.detail.audio);
        }) as EventListener,
      );

      handle.addEventListener(
        "agent_transcript",
        ((
          e: CustomEvent<{ reply_id: string; item_id: string; text: string }>,
        ) => {
          const { text } = e.detail;
          client.event({ type: "chat", text });
          conversationMessages.push({ role: "assistant", content: text });
        }) as EventListener,
      );

      handle.addEventListener(
        "tool_call",
        ((e: CustomEvent<S2sToolCall>) => {
          const p = handleToolCall(e.detail).catch((err: unknown) => {
            log.error("Tool call handler failed", { err });
          });
          const prev = turnPromise;
          turnPromise = (prev ?? Promise.resolve()).then(() => p).finally(
            () => {
              turnPromise = null;
            },
          );
        }) as EventListener,
      );

      handle.addEventListener(
        "reply_done",
        ((e: CustomEvent<{ reply_id: string; status: string }>) => {
          if (e.detail.status === "interrupted") {
            log.info("S2S reply interrupted (barge-in)");
            client.event({ type: "cancelled" });
          } else {
            client.playAudioDone();
            client.event({ type: "tts_done" });
          }
        }) as EventListener,
      );

      handle.addEventListener(
        "error",
        ((e: CustomEvent<{ code: string; message: string }>) => {
          log.error("S2S error", {
            code: e.detail.code,
            message: e.detail.message,
          });
          client.event({
            type: "error",
            code: "internal",
            message: e.detail.message,
          });
        }) as EventListener,
      );

      handle.addEventListener("close", () => {
        log.info("S2S closed");
        s2s = null;
        if (!sessionAbort.signal.aborted) {
          log.info("Attempting S2S reconnect");
          connectAndSetup().catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            log.error("S2S reconnect failed", { error: msg });
          });
        }
      });

      s2s = handle;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("S2S connect failed", { error: msg });
      client.event({ type: "error", code: "internal", message: msg });
    }
  }

  return {
    async start(): Promise<void> {
      metrics.sessionsTotal.inc(agentLabel);
      metrics.sessionsActive.inc(agentLabel);
      invokeHook("onConnect");
      await connectAndSetup();
    },

    async stop(): Promise<void> {
      if (sessionAbort.signal.aborted) return;
      sessionAbort.abort();
      metrics.sessionsActive.dec(agentLabel);
      if (turnPromise) await turnPromise;
      s2s?.close();
      invokeHook("onDisconnect");
    },

    onAudio(data: Uint8Array): void {
      s2s?.sendAudio(data);
    },

    onAudioReady(): void {
      if (audioReady) return;
      audioReady = true;
      // S2S handles greeting via system_prompt — no explicit TTS needed.
    },

    onCancel(): void {
      // S2S handles barge-in natively.
      client.event({ type: "cancelled" });
    },

    onReset(): void {
      conversationMessages = [];
      toolCallCount = 0;
      s2sSessionId = null;
      s2s?.close();
      // Reconnect happens via the close handler.
      client.event({ type: "reset" });
    },

    onHistory(
      incoming: readonly { role: "user" | "assistant"; text: string }[],
    ): void {
      for (const msg of incoming) {
        conversationMessages.push({ role: msg.role, content: msg.text });
      }
    },

    waitForTurn(): Promise<void> {
      return turnPromise ?? Promise.resolve();
    },
  };
}

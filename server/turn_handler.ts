// Copyright 2025 the AAI authors. MIT license.
import * as log from "@std/log";
import {
  type CoreMessage,
  type CoreSystemMessage,
  type CoreUserMessage,
  type LanguageModelV1,
  type StepResult,
  streamText,
  type ToolSet,
} from "ai";
import type { ToolChoice } from "@aai/sdk/types";
import * as metrics from "./metrics.ts";

const DEFAULT_STOP_WHEN = 5;

/** Maximum characters for tool result display. */
const MAX_TOOL_RESULT_LENGTH = 4000;

/** Tool lifecycle event emitted during the agentic loop. */
export type ToolEvent =
  | {
    kind: "start";
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
  }
  | { kind: "done"; toolCallId: string; result: string };

/** Creates a simple async push/pull channel for tool events. */
function createToolEventChannel(): {
  push(event: ToolEvent): void;
  done(): void;
  events: AsyncIterable<ToolEvent>;
} {
  const buffer: ToolEvent[] = [];
  let resolve: (() => void) | null = null;
  let finished = false;

  return {
    push(event: ToolEvent): void {
      buffer.push(event);
      resolve?.();
      resolve = null;
    },
    done(): void {
      finished = true;
      resolve?.();
      resolve = null;
    },
    events: {
      async *[Symbol.asyncIterator]() {
        while (true) {
          while (buffer.length > 0) {
            yield buffer.shift()!;
          }
          if (finished) return;
          await new Promise<void>((r) => {
            resolve = r;
          });
        }
      },
    },
  };
}

/** Options for executing a single conversational turn through the agentic loop. */
export type ExecuteTurnOptions = {
  /** Agent slug (used for logging and metrics). */
  agent: string;
  /** The language model to use for generation. */
  model: LanguageModelV1;
  /** System prompt for the LLM. */
  system: string;
  /** Conversation history (read-only, not mutated). */
  messages: readonly CoreMessage[];
  /** Available tools (both builtin and agent-defined). */
  tools: ToolSet;
  /** Abort signal to cancel the turn. */
  signal: AbortSignal;
  /** Maximum number of LLM steps before stopping (default: 5). */
  maxSteps?: number | undefined;
  /** Tool choice strategy passed to the LLM (default: "auto"). */
  toolChoice?: ToolChoice | undefined;
  /** Callback invoked after each LLM step completes (fire-and-forget). */
  onStep?:
    | ((step: StepResult<ToolSet>) => void)
    | undefined;
  /** Pre-resolved active tool filter (resolved once at turn start). */
  activeTools?: string[] | undefined;
};

/** Result of executing a turn: a stream of text deltas and tool events. */
export type TurnResult = {
  /** Async iterable of text deltas for streaming to TTS. */
  textStream: AsyncIterable<string>;
  /** Async iterable of tool lifecycle events for UI display. */
  toolEvents: AsyncIterable<ToolEvent>;
  /** Silently drain all internal promises to prevent dangling. Call on abort/error. */
  consume(): Promise<void>;
};

/**
 * Executes a single conversational turn through the agentic LLM loop.
 *
 * Uses streaming so text deltas can be piped directly to TTS. The LLM may
 * call tools across multiple steps until it produces a text response or
 * until `maxSteps` is reached.
 */
export function executeTurn(
  text: string,
  opts: ExecuteTurnOptions,
): TurnResult {
  const { agent, model, system, messages, tools, signal } = opts;
  const maxSteps = opts.maxSteps ?? DEFAULT_STOP_WHEN;
  const toolChoice = opts.toolChoice ?? "auto";
  const userMessage: CoreUserMessage = { role: "user", content: text };

  // Build messages with Anthropic cache breakpoints on system prompt and
  // conversation tail so repeated prefixes are served from prompt cache.
  const systemMessage: CoreSystemMessage = {
    role: "system",
    content: system,
    providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
  };
  const historyMessages: CoreMessage[] = [...messages];
  if (historyMessages.length > 0) {
    const last = historyMessages[historyMessages.length - 1];
    historyMessages[historyMessages.length - 1] = {
      ...last,
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    } as CoreMessage;
  }

  const result = streamText({
    model,
    messages: [systemMessage, ...historyMessages, userMessage],
    tools,
    toolChoice,
    toolCallStreaming: true,
    maxSteps,
    abortSignal: signal,
    onStepFinish: (step: StepResult<ToolSet>) => {
      if (step.toolCalls) {
        for (const tc of step.toolCalls) {
          log.info("tool call", { tool: tc.toolName, agent });
          metrics.toolDuration.observe(0, { agent, tool: tc.toolName });
        }
      }
      opts.onStep?.(step);
    },
  });

  // Suppress unhandled rejections on internal promises but log errors
  const logErr = (err: unknown) =>
    log.error("streamText internal error", { err });
  result.text.catch(logErr);
  result.response.then(() => {}, logErr);
  result.toolCalls.catch(logErr);

  const toolChannel = createToolEventChannel();

  // Wrap fullStream to insert a space between text produced by different steps
  // and emit tool events as a side effect. Both `tool-call` and `tool-result`
  // are native fullStream chunk types in the Vercel AI SDK.
  async function* textStreamWithStepSeparators(): AsyncIterable<string> {
    let lastChar = "";
    let atStepBoundary = false;
    try {
      for await (const chunk of result.fullStream) {
        if (chunk.type === "error") {
          throw chunk.error;
        } else if (chunk.type === "step-finish") {
          atStepBoundary = true;
        } else if (chunk.type === "text-delta" && chunk.textDelta) {
          if (
            atStepBoundary && lastChar && !/\s$/.test(lastChar) &&
            !/^\s/.test(chunk.textDelta)
          ) {
            yield " ";
          }
          atStepBoundary = false;
          yield chunk.textDelta;
          lastChar = chunk.textDelta;
        } else if (chunk.type === "tool-call") {
          toolChannel.push({
            kind: "start",
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            args: chunk.args as Record<string, unknown>,
          });
          // tool-result appears later in fullStream when tools have execute().
          // ToolSet is generic so TS can't prove it, but it does appear at runtime.
          // deno-lint-ignore no-explicit-any
        } else if ((chunk as any).type === "tool-result") {
          // deno-lint-ignore no-explicit-any
          const tc = chunk as any;
          const raw = typeof tc.result === "string"
            ? tc.result
            : JSON.stringify(tc.result);
          toolChannel.push({
            kind: "done",
            toolCallId: tc.toolCallId,
            result: raw.length > MAX_TOOL_RESULT_LENGTH
              ? raw.slice(0, MAX_TOOL_RESULT_LENGTH)
              : raw,
          });
        }
      }
    } finally {
      toolChannel.done();
    }
  }

  return {
    textStream: textStreamWithStepSeparators(),
    toolEvents: toolChannel.events,
    async consume(): Promise<void> {
      await Promise.allSettled([
        result.text,
        result.response,
        result.toolCalls,
      ]);
    },
  };
}

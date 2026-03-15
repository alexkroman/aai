// Copyright 2025 the AAI authors. MIT license.
import * as log from "@std/log";
import {
  type CoreMessage,
  type CoreUserMessage,
  type LanguageModelV1,
  type StepResult,
  streamText,
  type ToolSet,
} from "ai";
import type { ToolChoice } from "@aai/sdk/types";
import * as metrics from "./metrics.ts";

const DEFAULT_STOP_WHEN = 5;

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

/** Result of executing a turn: a stream of text deltas. */
export type TurnResult = {
  /** Async iterable of text deltas for streaming to TTS. */
  textStream: AsyncIterable<string>;
  /** Silently drain all internal promises to prevent dangling. Call on abort/error. */
  consume(): Promise<void>;
};

/**
 * Executes a single conversational turn through the agentic LLM loop.
 *
 * Uses streaming so text deltas can be piped directly to TTS. The LLM may
 * call tools across multiple steps until it produces a text response or
 * calls `user_input`, or until `maxSteps` is reached.
 */
export function executeTurn(
  text: string,
  opts: ExecuteTurnOptions,
): TurnResult {
  const { agent, model, system, messages, tools, signal } = opts;
  const maxSteps = opts.maxSteps ?? DEFAULT_STOP_WHEN;
  const toolChoice = opts.toolChoice ?? "auto";
  const userMessage: CoreUserMessage = { role: "user", content: text };

  const result = streamText({
    model,
    system,
    messages: [...messages, userMessage],
    tools,
    toolChoice,
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

  return {
    textStream: result.textStream,
    async consume(): Promise<void> {
      await Promise.allSettled([
        result.text,
        result.response,
        result.toolCalls,
      ]);
    },
  };
}

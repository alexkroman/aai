// Copyright 2025 the AAI authors. MIT license.
import * as log from "@std/log";
import {
  type CoreMessage,
  type CoreUserMessage,
  generateText,
  type GenerateTextResult,
  type LanguageModelV1,
  type StepResult,
  type ToolCallUnion,
  type ToolSet,
} from "ai";
import type { ToolChoice } from "@aai/sdk/types";
import { FINAL_ANSWER_TOOL, USER_INPUT_TOOL } from "./builtin_tools.ts";
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
  /** Conversation history (mutated in place with new messages). */
  messages: CoreMessage[];
  /** Available tools (both builtin and agent-defined). */
  tools: ToolSet;
  /** Abort signal to cancel the turn. */
  signal: AbortSignal;
  /** Maximum number of LLM steps before forcing `final_answer` (default: 5). */
  maxSteps?: number | undefined;
  /** Tool choice strategy passed to the LLM (default: "auto"). */
  toolChoice?: ToolChoice | undefined;
  /** Callback invoked after each LLM step completes. */
  onStep?:
    | ((step: StepResult<ToolSet>) => void | Promise<void>)
    | undefined;
  /** Hook called before each step to optionally filter active tools. */
  resolveBeforeStep?:
    | ((
      stepNumber: number,
    ) => Promise<{ activeTools?: string[] } | null>)
    | undefined;
};

/**
 * Executes a single conversational turn through the agentic LLM loop.
 *
 * Sends the user's text to the LLM along with conversation history and
 * available tools. The LLM may call tools across multiple steps until it
 * produces a `final_answer` or `user_input` call, or until `maxSteps` is
 * reached (at which point `final_answer` is forced).
 *
 * @param text - The user's transcribed speech for this turn.
 * @param opts - Turn execution options including model, tools, and signal.
 * @returns The agent's text response to be spoken via TTS.
 */
export async function executeTurn(
  text: string,
  opts: ExecuteTurnOptions,
): Promise<string> {
  const {
    agent,
    model,
    system,
    messages,
    tools,
    signal,
  } = opts;
  const maxSteps = opts.maxSteps ?? DEFAULT_STOP_WHEN;
  const toolChoice = opts.toolChoice ?? "auto";

  const userMessage: CoreUserMessage = { role: "user", content: text };

  const result: GenerateTextResult<ToolSet, string> = await generateText({
    model,
    system,
    messages: [...messages, userMessage],
    tools,
    toolChoice,
    maxSteps,
    abortSignal: signal,
    experimental_prepareStep: async ({ stepNumber }) => {
      // On the last step, force final_answer so we don't get stuck
      if (stepNumber === maxSteps - 1) {
        return {
          toolChoice: { type: "tool", toolName: FINAL_ANSWER_TOOL },
        };
      }
      // Let the agent's onBeforeStep filter active tools
      if (opts.resolveBeforeStep) {
        const result = await opts.resolveBeforeStep(stepNumber);
        if (result?.activeTools) {
          return {
            toolChoice,
            experimental_activeTools: result.activeTools,
          };
        }
      }
      return undefined;
    },
    onStepFinish: async (step: StepResult<ToolSet>) => {
      if (step.toolCalls) {
        for (const tc of step.toolCalls) {
          log.info("tool call", { tool: tc.toolName, agent });
          metrics.toolDuration.observe(0, { agent, tool: tc.toolName });
        }
      }
      if (opts.onStep) {
        await opts.onStep(step);
      }
    },
  });

  // Append the user message + all response messages to conversation history
  messages.push(userMessage);
  messages.push(...result.response.messages);

  // Check if the last step called final_answer or user_input
  // These tools have no execute, so they stop the loop
  const lastToolCalls = result.toolCalls;
  if (lastToolCalls?.length) {
    const answerCall = lastToolCalls.find(
      (tc: ToolCallUnion<ToolSet>) => tc.toolName === FINAL_ANSWER_TOOL,
    );
    if (answerCall) {
      const answer = (answerCall.args as { answer?: string }).answer ?? "";
      log.info("turn complete (final_answer)", {
        responseLength: answer.length,
      });
      return answer;
    }

    const questionCall = lastToolCalls.find(
      (tc: ToolCallUnion<ToolSet>) => tc.toolName === USER_INPUT_TOOL,
    );
    if (questionCall) {
      const question = (questionCall.args as { question?: string }).question ??
        "";
      log.info("turn complete (user_input)", {
        questionLength: question.length,
      });
      return question;
    }
  }

  // Fallback: use the text response
  const responseText = result.text ||
    "Sorry, I couldn't generate a response.";
  log.info("turn complete", { responseLength: responseText.length });
  return responseText;
}

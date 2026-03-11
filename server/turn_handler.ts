import { type CoreMessage, generateText, type LanguageModelV1 } from "ai";
import { FINAL_ANSWER_TOOL, USER_INPUT_TOOL } from "./builtin_tools.ts";
import * as metrics from "./metrics.ts";

const DEFAULT_STOP_WHEN = 5;

export type ExecuteTurnOptions = {
  agent: string;
  model: LanguageModelV1;
  system: string;
  messages: CoreMessage[];
  // deno-lint-ignore no-explicit-any
  tools: Record<string, any>;
  signal: AbortSignal;
  stopWhen?: number;
};

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
  const maxSteps = opts.stopWhen ?? DEFAULT_STOP_WHEN;

  const result = await generateText({
    model,
    system,
    messages: [
      ...messages,
      { role: "user" as const, content: text },
    ],
    tools,
    toolChoice: "auto",
    maxSteps,
    abortSignal: signal,
    // deno-lint-ignore require-await
    experimental_prepareStep: async ({ stepNumber }) => {
      // On the last step, force final_answer so we don't get stuck
      if (stepNumber === maxSteps - 1) {
        return {
          toolChoice: { type: "tool", toolName: FINAL_ANSWER_TOOL },
        };
      }
      return undefined;
    },
    onStepFinish: ({ toolCalls }) => {
      if (toolCalls) {
        for (const tc of toolCalls) {
          console.info("tool call", { tool: tc.toolName, agent });
          metrics.toolDuration.observe(0, { agent, tool: tc.toolName });
        }
      }
    },
  });

  // Append the user message + all response messages to conversation history
  messages.push({ role: "user", content: text });
  messages.push(...result.response.messages);

  // Check if the last step called final_answer or user_input
  // These tools have no execute, so they stop the loop
  const lastToolCalls = result.toolCalls;
  if (lastToolCalls?.length) {
    const answerCall = lastToolCalls.find(
      (tc) => tc.toolName === FINAL_ANSWER_TOOL,
    );
    if (answerCall) {
      const answer = (answerCall.args as { answer?: string }).answer ?? "";
      console.info("turn complete (final_answer)", {
        responseLength: answer.length,
      });
      return answer;
    }

    const questionCall = lastToolCalls.find(
      (tc) => tc.toolName === USER_INPUT_TOOL,
    );
    if (questionCall) {
      const question = (questionCall.args as { question?: string }).question ??
        "";
      console.info("turn complete (user_input)", {
        questionLength: question.length,
      });
      return question;
    }
  }

  // Fallback: use the text response
  const responseText = result.text ||
    "Sorry, I couldn't generate a response.";
  console.info("turn complete", { responseLength: responseText.length });
  return responseText;
}

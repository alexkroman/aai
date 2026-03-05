import { expect } from "@std/expect";
import { executeTurn, type TurnCallLLMOptions } from "./turn_handler.ts";
import { createMockLLMResponse, responses } from "./_test_utils.ts";
import type { ChatMessage, LLMResponse, ToolSchema } from "./types.ts";
import { getLogger } from "./logger.ts";

const logger = getLogger("test-turn");

function ctx(overrides?: {
  messages?: ChatMessage[];
  toolSchemas?: ToolSchema[];
  callLLM?: (opts: TurnCallLLMOptions) => Promise<LLMResponse>;
  executeTool?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<string>;
}) {
  const toolCalls: { name: string; args: Record<string, unknown> }[] = [];
  return {
    messages: overrides?.messages ??
      [{ role: "system" as const, content: "You are helpful." }],
    toolSchemas: overrides?.toolSchemas ?? [] as ToolSchema[],
    callLLM: overrides?.callLLM ??
      (() => Promise.resolve(createMockLLMResponse("Hello from LLM"))),
    executeTool: overrides?.executeTool ??
      ((name: string, args: Record<string, unknown>) => {
        toolCalls.push({ name, args });
        return Promise.resolve('"tool result"');
      }),
    toolCalls,
  };
}

const signal = () => new AbortController().signal;

Deno.test("executeTurn", async (t) => {
  await t.step("pushes user message and returns LLM text", async () => {
    const c = ctx();
    const result = await executeTurn("Hello", {
      messages: c.messages,
      toolSchemas: c.toolSchemas,
      callLLM: c.callLLM,
      executeTool: c.executeTool,
      signal: signal(),
      logger,
    });

    expect(result).toBe("Hello from LLM");
    expect(c.messages[1]).toEqual({ role: "user", content: "Hello" });
    expect(c.messages[2]).toEqual({
      role: "assistant",
      content: "Hello from LLM",
    });
  });

  await t.step("passes signal to callLLM", async () => {
    const abort = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const c = ctx({
      callLLM: (opts: TurnCallLLMOptions) => {
        receivedSignal = opts.signal;
        return Promise.resolve(createMockLLMResponse("ok"));
      },
    });

    await executeTurn("Hi", {
      messages: c.messages,
      toolSchemas: c.toolSchemas,
      callLLM: c.callLLM,
      executeTool: c.executeTool,
      signal: abort.signal,
      logger,
    });
    expect(receivedSignal).toBe(abort.signal);
  });

  await t.step("returns fallback text when LLM content is null", async () => {
    const c = ctx({ callLLM: responses(createMockLLMResponse(null)) });
    const result = await executeTurn("Hi", {
      messages: c.messages,
      toolSchemas: c.toolSchemas,
      callLLM: c.callLLM,
      executeTool: c.executeTool,
      signal: signal(),
      logger,
    });
    expect(result).toBe("Sorry, I couldn't generate a response.");
  });

  await t.step("returns empty text when choices array is empty", async () => {
    const c = ctx({ callLLM: () => Promise.resolve({ choices: [] }) });
    const result = await executeTurn("Hi", {
      messages: c.messages,
      toolSchemas: c.toolSchemas,
      callLLM: c.callLLM,
      executeTool: c.executeTool,
      signal: signal(),
      logger,
    });
    expect(result).toBe("");
  });

  await t.step("mutates the messages array in-place", async () => {
    const messages: ChatMessage[] = [{
      role: "system",
      content: "System prompt",
    }];
    const c = ctx({ messages });
    await executeTurn("Hi", {
      messages: c.messages,
      toolSchemas: c.toolSchemas,
      callLLM: c.callLLM,
      executeTool: c.executeTool,
      signal: signal(),
      logger,
    });

    expect(messages.length).toBe(3);
    expect(messages[1].role).toBe("user");
    expect(messages[2].role).toBe("assistant");
  });

  await t.step("tool calls", async (t) => {
    await t.step("executes tool and re-calls LLM with results", async () => {
      const c = ctx({
        callLLM: responses(
          createMockLLMResponse(null, [{
            id: "c1",
            name: "get_weather",
            arguments: '{"city":"NYC"}',
          }]),
          createMockLLMResponse("Sunny in NYC."),
        ),
      });

      const result = await executeTurn("Weather?", {
        messages: c.messages,
        toolSchemas: c.toolSchemas,
        callLLM: c.callLLM,
        executeTool: c.executeTool,
        signal: signal(),
        logger,
      });

      expect(result).toBe("Sunny in NYC.");
      expect(c.toolCalls).toEqual([{
        name: "get_weather",
        args: { city: "NYC" },
      }]);
      expect(c.messages.length).toBe(5); // system, user, assistant(tool_calls), tool, assistant
      expect(c.messages[3].role).toBe("tool");
      expect(c.messages[3].content).toBe('"tool result"');
    });

    await t.step("handles invalid JSON tool arguments gracefully", async () => {
      const c = ctx({
        callLLM: responses(
          createMockLLMResponse(null, [{
            id: "c1",
            name: "bad_tool",
            arguments: "not json",
          }]),
          createMockLLMResponse("Recovered."),
        ),
      });

      const result = await executeTurn("Test", {
        messages: c.messages,
        toolSchemas: c.toolSchemas,
        callLLM: c.callLLM,
        executeTool: c.executeTool,
        signal: signal(),
        logger,
      });

      expect(result).toBe("Recovered.");
      expect(
        c.messages.find((m) =>
          m.role === "tool" && m.content?.includes("Invalid JSON")
        ),
      ).toBeDefined();
    });

    await t.step("handles rejected tool execution", async () => {
      const c = ctx({
        callLLM: responses(
          createMockLLMResponse(null, [{
            id: "c1",
            name: "failing",
            arguments: "{}",
          }]),
          createMockLLMResponse("Handled."),
        ),
        executeTool: () => Promise.reject(new Error("tool boom")),
      });

      const result = await executeTurn("Go", {
        messages: c.messages,
        toolSchemas: c.toolSchemas,
        callLLM: c.callLLM,
        executeTool: c.executeTool,
        signal: signal(),
        logger,
      });

      expect(result).toBe("Handled.");
      expect(
        c.messages.find((m) =>
          m.role === "tool" && m.content?.includes("Error:")
        ),
      ).toBeDefined();
    });

    await t.step("executes multiple tool calls in parallel", async () => {
      const c = ctx({
        callLLM: responses(
          createMockLLMResponse(null, [
            { id: "c1", name: "tool_a", arguments: '{"a":1}' },
            { id: "c2", name: "tool_b", arguments: '{"b":2}' },
          ]),
          createMockLLMResponse("Both done."),
        ),
      });

      const result = await executeTurn("Go", {
        messages: c.messages,
        toolSchemas: c.toolSchemas,
        callLLM: c.callLLM,
        executeTool: c.executeTool,
        signal: signal(),
        logger,
      });

      expect(result).toBe("Both done.");
      expect(c.toolCalls.length).toBe(2);
      const toolMsgs = c.messages.filter((m) => m.role === "tool");
      expect(toolMsgs.length).toBe(2);
      expect(toolMsgs[0].tool_call_id).toBe("c1");
      expect(toolMsgs[1].tool_call_id).toBe("c2");
    });

    await t.step(
      "returns fallback after MAX_TOOL_ITERATIONS",
      async () => {
        const toolResp = createMockLLMResponse(null, [
          { id: "c1", name: "loop_tool", arguments: "{}" },
        ]);
        const fallbackResp = createMockLLMResponse("Here are the results.");

        let callCount = 0;
        const c = ctx({
          callLLM: () => {
            callCount++;
            if (callCount > 3) return Promise.resolve(fallbackResp);
            return Promise.resolve(toolResp);
          },
        });

        const result = await executeTurn("Go", {
          messages: c.messages,
          toolSchemas: c.toolSchemas,
          callLLM: c.callLLM,
          executeTool: c.executeTool,
          signal: signal(),
          logger,
        });

        expect(result).toBe("Here are the results.");
        expect(c.toolCalls.length).toBe(3);
        expect(callCount).toBe(4); // 1 initial + 2 re-calls + 1 final
      },
    );

    await t.step(
      "skips truncated tool calls on max_tokens and retries",
      async () => {
        const truncatedResp: LLMResponse = {
          choices: [{
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: "c1",
                type: "function" as const,
                function: { name: "run_code", arguments: "{}" },
              }],
            },
            finish_reason: "max_tokens",
          }],
        };
        const c = ctx({
          callLLM: responses(
            truncatedResp,
            createMockLLMResponse("Here you go."),
          ),
        });

        const result = await executeTurn("Run code", {
          messages: c.messages,
          toolSchemas: c.toolSchemas,
          callLLM: c.callLLM,
          executeTool: c.executeTool,
          signal: signal(),
          logger,
        });

        expect(result).toBe("Here you go.");
        expect(c.toolCalls.length).toBe(0);
      },
    );
  });

  await t.step("abort signal", async (t) => {
    await t.step(
      "stops tool loop when signal is aborted mid-iteration",
      async () => {
        const abort = new AbortController();
        const c = ctx({
          callLLM: responses(
            createMockLLMResponse(null, [{
              id: "c1",
              name: "slow",
              arguments: "{}",
            }]),
          ),
          executeTool: () => {
            abort.abort();
            return Promise.resolve("done");
          },
        });

        const result = await executeTurn("Go", {
          messages: c.messages,
          toolSchemas: c.toolSchemas,
          callLLM: c.callLLM,
          executeTool: c.executeTool,
          signal: abort.signal,
          logger,
        });
        expect(result).toBe("");
      },
    );
  });
});

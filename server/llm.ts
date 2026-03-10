import OpenAI from "openai";
import type { ChatMessage, LLMResponse } from "./types.ts";
import type { ToolSchema } from "@aai/sdk/types";
import * as metrics from "./metrics.ts";

export const _internals = {
  createClient: (apiKey: string, baseURL: string) =>
    new OpenAI({ apiKey, baseURL }),
};

function sanitizeMessages(
  messages: ChatMessage[],
): OpenAI.ChatCompletionMessageParam[] {
  return messages.map((msg) => {
    if (msg.role === "system") {
      return {
        role: "system" as const,
        content: msg.content ?? "...",
      };
    }
    if (msg.role === "assistant" && msg.tool_calls?.length) {
      return {
        role: "assistant" as const,
        content: msg.content?.trim() ? msg.content : null,
        tool_calls: msg.tool_calls.map((tc) => {
          const args = tc.function.arguments;
          let safeArgs = args || "{}";
          try {
            const parsed = JSON.parse(safeArgs);
            if (
              typeof parsed !== "object" || parsed === null ||
              Array.isArray(parsed)
            ) {
              safeArgs = "{}";
            }
          } catch {
            safeArgs = "{}";
          }
          // Gateway bug: it drops tool_use.input when arguments parses to
          // an empty object. Work around by ensuring at least one key.
          if (safeArgs === "{}") {
            safeArgs = '{"_":""}';
          }
          return {
            id: tc.id,
            type: "function" as const,
            function: { name: tc.function.name, arguments: safeArgs },
          };
        }),
      };
    }
    if (msg.role === "tool") {
      return {
        role: "tool" as const,
        content: msg.content || "...",
        tool_call_id: msg.tool_call_id ?? "",
      };
    }
    if (msg.role === "assistant") {
      return {
        role: "assistant" as const,
        content: msg.content?.trim() ? msg.content : "...",
      };
    }
    // user
    return {
      role: "user" as const,
      content: msg.content?.trim() ? msg.content : "...",
    };
  });
}

export type CallLLMOptions = {
  messages: ChatMessage[];
  tools: ToolSchema[];
  apiKey: string;
  model: string;
  signal?: AbortSignal;
  gatewayBase?: string;
  toolChoice?:
    | "auto"
    | "none"
    | "required"
    | { type: "function"; function: { name: string } };
  maxTokens?: number;
};

export async function callLLM(opts: CallLLMOptions): Promise<LLMResponse> {
  const base = opts.gatewayBase ?? "https://llm-gateway.assemblyai.com/v1";
  const client = _internals.createClient(opts.apiKey, base);

  console.debug("LLM request", {
    model: opts.model,
    messageCount: opts.messages.length,
    toolCount: opts.tools.length,
    toolChoice: opts.toolChoice ?? "auto",
    toolNames: opts.tools.map((t) => t.name),
  });

  const llmStart = performance.now();
  try {
    // deno-lint-ignore no-explicit-any
    const params: any = {
      model: opts.model,
      max_tokens: opts.maxTokens ?? 8000,
      messages: sanitizeMessages(opts.messages),
    };

    if (opts.tools.length > 0) {
      params.tools = opts.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
      params.tool_choice = opts.toolChoice ?? "auto";
    }

    const resp = await client.chat.completions.create(params, {
      signal: opts.signal ?? undefined,
    });

    const choice = resp.choices?.[0];
    console.debug("LLM raw response", {
      hasChoices: !!resp.choices?.length,
      finishReason: choice?.finish_reason,
      hasToolCalls: !!choice?.message?.tool_calls?.length,
      contentPreview: typeof choice?.message?.content === "string"
        ? choice.message.content.slice(0, 200)
        : typeof choice?.message?.content,
    });

    metrics.llmDuration.observe((performance.now() - llmStart) / 1000);

    return {
      id: resp.id,
      choices: (resp.choices ?? []).map((c) => ({
        index: c.index,
        message: {
          role: "assistant",
          content: c.message.content,
          ...(c.message.tool_calls?.length
            ? {
              tool_calls: c.message.tool_calls.map((tc) => ({
                id: tc.id,
                type: "function" as const,
                function: {
                  name: tc.function.name,
                  arguments: tc.function.arguments,
                },
              })),
            }
            : {}),
        },
        finish_reason: c.finish_reason ?? "stop",
      })),
    };
  } catch (err: unknown) {
    metrics.llmDuration.observe((performance.now() - llmStart) / 1000);
    metrics.errorsTotal.inc({ component: "llm" });
    const msg = err instanceof Error ? err.message : String(err);
    console.error("LLM request failed", {
      error: msg,
      model: opts.model,
      messageCount: opts.messages.length,
    });
    throw new Error(`LLM request failed: ${msg}`);
  }
}

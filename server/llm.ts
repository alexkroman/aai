import {
  type ChatMessage,
  type LLMResponse,
  LLMResponseSchema,
} from "./types.ts";
import type { ToolSchema } from "@aai/sdk/types";

export const _internals = {
  fetch: globalThis.fetch,
};

function sanitizeMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((msg) => {
    let result = msg;
    if (typeof result.content === "string" && !result.content.trim()) {
      // Assistant messages with tool_calls should have content: null (OpenAI
      // convention). Setting it to a non-empty string confuses the gateway's
      // conversion to Anthropic tool_use blocks. For other roles, use "...".
      result = {
        ...result,
        content: result.tool_calls?.length ? null : "...",
      };
    }
    // Ensure tool_calls always have valid JSON object arguments for the gateway.
    // The Anthropic API requires tool_use.input to be an object, so arguments
    // must parse to a plain object — not null, a string, or a primitive.
    if (result.tool_calls?.length) {
      result = {
        ...result,
        tool_calls: result.tool_calls.map((tc) => {
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
          if (safeArgs === args) return tc;
          return {
            ...tc,
            function: { ...tc.function, arguments: safeArgs },
          };
        }),
      };
    }
    return result;
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

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: sanitizeMessages(opts.messages),
    max_tokens: opts.maxTokens ?? 8000,
  };

  if (opts.tools.length > 0) {
    body.tools = opts.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
    body.tool_choice = opts.toolChoice ?? "auto";
  }

  console.debug("LLM request", {
    model: opts.model,
    messageCount: opts.messages.length,
    toolCount: opts.tools.length,
    toolChoice: body.tool_choice,
    toolNames: opts.tools.map((t) => t.name),
  });

  const resp = await _internals.fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error("LLM request failed", {
      status: resp.status,
      body: text.slice(0, 500),
      model: opts.model,
      messageCount: opts.messages.length,
    });
    throw new Error(`LLM request failed: ${resp.status} ${text}`);
  }

  const json = await resp.json();
  console.debug("LLM raw response", {
    hasChoices: Array.isArray(json.choices),
    finishReason: json.choices?.[0]?.finish_reason,
    hasToolCalls: !!json.choices?.[0]?.message?.tool_calls?.length,
    contentPreview: typeof json.choices?.[0]?.message?.content === "string"
      ? json.choices[0].message.content.slice(0, 200)
      : typeof json.choices?.[0]?.message?.content,
  });
  const parsed = LLMResponseSchema.safeParse(json);
  if (!parsed.success) {
    console.error("LLM response validation failed", {
      error: parsed.error.message,
      raw: JSON.stringify(json).slice(0, 500),
    });
    throw new Error(`Invalid LLM response: ${parsed.error.message}`);
  }
  return parsed.data;
}

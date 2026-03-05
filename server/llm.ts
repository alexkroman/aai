import {
  type ChatMessage,
  type LLMResponse,
  LLMResponseSchema,
  type ToolSchema,
} from "./types.ts";
import { getLogger } from "./logger.ts";

const log = getLogger("llm");

function sanitizeMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((msg) => {
    if (typeof msg.content === "string" && !msg.content.trim()) {
      return { ...msg, content: "..." };
    }
    return msg;
  });
}

export interface CallLLMOptions {
  messages: ChatMessage[];
  tools: ToolSchema[];
  apiKey: string;
  model: string;
  signal?: AbortSignal;
  gatewayBase?: string;
  fetch?: typeof globalThis.fetch;
  toolChoice?:
    | "auto"
    | "none"
    | "required"
    | { type: "function"; function: { name: string } };
  maxTokens?: number;
}

export async function callLLM(opts: CallLLMOptions): Promise<LLMResponse> {
  const base = opts.gatewayBase ?? "https://llm-gateway.assemblyai.com/v1";
  const fetchFn = opts.fetch ?? globalThis.fetch;

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: sanitizeMessages(opts.messages),
    max_tokens: opts.maxTokens ?? 1024,
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

  log.debug("LLM request", {
    model: opts.model,
    messageCount: opts.messages.length,
    toolCount: opts.tools.length,
    toolChoice: body.tool_choice,
    toolNames: opts.tools.map((t) => t.name),
  });

  const resp = await fetchFn(`${base}/chat/completions`, {
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
    throw new Error(`LLM request failed: ${resp.status} ${text}`);
  }

  const json = await resp.json();
  log.debug("LLM raw response", {
    hasChoices: Array.isArray(json.choices),
    finishReason: json.choices?.[0]?.finish_reason,
    hasToolCalls: !!json.choices?.[0]?.message?.tool_calls?.length,
    contentPreview: typeof json.choices?.[0]?.message?.content === "string"
      ? json.choices[0].message.content.slice(0, 200)
      : typeof json.choices?.[0]?.message?.content,
  });
  const parsed = LLMResponseSchema.safeParse(json);
  if (!parsed.success) {
    log.error("LLM response validation failed", {
      error: parsed.error.message,
      raw: JSON.stringify(json).slice(0, 500),
    });
    throw new Error(`Invalid LLM response: ${parsed.error.message}`);
  }
  return parsed.data;
}

/**
 * Streaming version of callLLM. Always uses stream: true.
 * Calls onDelta for each content token as it arrives.
 * Returns the full assembled LLMResponse when done.
 *
 * For tool calls: onDelta is never called (tool args arrive as tool_calls deltas).
 * For text: onDelta fires for each token AND the full text is in the response.
 */
export async function callLLMStream(
  opts: CallLLMOptions & { onDelta?: (text: string) => void },
): Promise<LLMResponse> {
  const base = opts.gatewayBase ?? "https://llm-gateway.assemblyai.com/v1";
  const fetchFn = opts.fetch ?? globalThis.fetch;

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: sanitizeMessages(opts.messages),
    max_tokens: opts.maxTokens ?? 1024,
    stream: true,
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

  log.debug("LLM stream request", {
    model: opts.model,
    messageCount: opts.messages.length,
    toolCount: opts.tools.length,
  });

  const resp = await fetchFn(`${base}/chat/completions`, {
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
    throw new Error(`LLM stream request failed: ${resp.status} ${text}`);
  }

  if (!resp.body) {
    throw new Error("LLM stream response has no body");
  }

  // Assemble the full response from SSE deltas
  let content = "";
  let finishReason = "stop";
  const toolCalls: Map<
    number,
    { id: string; type: string; function: { name: string; arguments: string } }
  > = new Map();

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split("\n");
      sseBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") break;

        try {
          const chunk = JSON.parse(data);
          const delta = chunk.choices?.[0]?.delta;
          const reason = chunk.choices?.[0]?.finish_reason;
          if (reason) finishReason = reason;
          if (!delta) continue;

          // Content deltas
          if (typeof delta.content === "string" && delta.content) {
            content += delta.content;
            opts.onDelta?.(delta.content);
          }

          // Tool call deltas
          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCalls.has(idx)) {
                toolCalls.set(idx, {
                  id: tc.id ?? "",
                  type: tc.type ?? "function",
                  function: { name: "", arguments: "" },
                });
              }
              const entry = toolCalls.get(idx)!;
              if (tc.id) entry.id = tc.id;
              if (tc.function?.name) entry.function.name += tc.function.name;
              if (tc.function?.arguments) {
                entry.function.arguments += tc.function.arguments;
              }
            }
          }
        } catch {
          log.debug("Failed to parse SSE chunk", { data });
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Build the assembled LLMResponse
  const message: Record<string, unknown> = {
    role: "assistant",
    content: content || null,
  };
  if (toolCalls.size > 0) {
    message.tool_calls = [...toolCalls.values()];
  }

  const assembled = {
    choices: [{ message, finish_reason: finishReason }],
  };

  log.debug("LLM stream response assembled", {
    finishReason,
    hasToolCalls: toolCalls.size > 0,
    contentLength: content.length,
  });

  const parsed = LLMResponseSchema.safeParse(assembled);
  if (!parsed.success) {
    log.error("LLM stream response validation failed", {
      error: parsed.error.message,
      raw: JSON.stringify(assembled).slice(0, 500),
    });
    throw new Error(`Invalid LLM response: ${parsed.error.message}`);
  }
  return parsed.data;
}

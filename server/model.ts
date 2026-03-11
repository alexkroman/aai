import { createOpenAI } from "@ai-sdk/openai";
import {
  type LanguageModelV1,
  type LanguageModelV1Middleware,
  wrapLanguageModel,
} from "ai";

const DEFAULT_GATEWAY = "https://llm-gateway.assemblyai.com/v1";

/**
 * Middleware that works around a gateway bug: it drops `tool_use.input`
 * when the arguments parse to an empty object `{}`.
 * We ensure at least one key by replacing `{}` with `{"_":""}`.
 */
const gatewayBugMiddleware: LanguageModelV1Middleware = {
  // deno-lint-ignore no-explicit-any
  transformParams: ({ params }: { params: any }) => {
    const messages = params.prompt;
    if (!Array.isArray(messages)) return params;

    const patched = messages.map(
      // deno-lint-ignore no-explicit-any
      (msg: any) => {
        if (msg.role !== "assistant") return msg;
        const content = msg.content;
        if (!Array.isArray(content)) return msg;

        const patchedContent = content.map(
          // deno-lint-ignore no-explicit-any
          (part: any) => {
            if (part.type !== "tool-call") return part;
            const args = part.args;
            if (
              typeof args === "object" && args !== null &&
              !Array.isArray(args) &&
              Object.keys(args).length === 0
            ) {
              return { ...part, args: { _: "" } };
            }
            return part;
          },
        );

        return { ...msg, content: patchedContent };
      },
    );

    return { ...params, prompt: patched };
  },
};

/**
 * Custom fetch that normalizes the LLM gateway response for the Vercel SDK.
 * The gateway returns non-standard responses:
 * - Multiple choices (content + tool_calls in separate choices)
 * - Missing `index` field on choices (required by @ai-sdk/openai)
 *
 * We merge the choices into a single one and add missing `index` fields.
 */
function createGatewayFetch(
  baseFetch: typeof globalThis.fetch = globalThis.fetch,
): typeof globalThis.fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init);

    // Only patch JSON responses from the chat completions endpoint
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    if (!url.includes("/chat/completions")) return response;

    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      // Not JSON — return as-is
      return new Response(text, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    if (Array.isArray(body.choices) && body.choices.length > 0) {
      // Merge multiple choices: find the one with tool_calls (prefer it),
      // fall back to the first with content
      // deno-lint-ignore no-explicit-any
      let merged = body.choices.find((c: any) => c.message?.tool_calls?.length);
      if (!merged) merged = body.choices[0];

      // If there's a content-only choice and a tool_calls choice, merge content
      // deno-lint-ignore no-explicit-any
      const contentChoice = body.choices.find((c: any) =>
        c.message?.content && !c.message?.tool_calls?.length
      );
      if (contentChoice && merged !== contentChoice && merged.message) {
        merged.message.content = merged.message.content ||
          contentChoice.message.content;
      }

      // Ensure index field exists on the merged choice
      if (merged.index === undefined) merged.index = 0;

      body.choices = [merged];
    }

    return new Response(JSON.stringify(body), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

export type CreateModelOptions = {
  apiKey: string;
  model: string;
  gatewayBase?: string;
};

export function createModel(opts: CreateModelOptions): LanguageModelV1 {
  const openai = createOpenAI({
    baseURL: opts.gatewayBase ?? DEFAULT_GATEWAY,
    apiKey: opts.apiKey,
    fetch: createGatewayFetch(),
  });
  return wrapLanguageModel({
    model: openai(opts.model),
    middleware: gatewayBugMiddleware,
  });
}

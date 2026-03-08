import type { SessionOptions, SessionTransport } from "./session.ts";
import type { PlatformConfig } from "./config.ts";
import { resolvesNext, spy } from "@std/testing/mock";
import type { CallLLMOptions } from "./llm.ts";
import type { ChatMessage, LLMResponse } from "./types.ts";
import { DEFAULT_STT_CONFIG, DEFAULT_TTS_CONFIG } from "./types.ts";
import type { ToolSchema } from "../sdk/types.ts";
import {
  type BundleStore,
  createBundleStore,
  createMemoryS3Client,
} from "./bundle_store_tigris.ts";

export const flush = (): Promise<void> =>
  new Promise<void>((r) => setTimeout(r, 0));

export function createMockTransport(): SessionTransport & {
  sent: (string | ArrayBuffer | Uint8Array)[];
} {
  const sent: (string | ArrayBuffer | Uint8Array)[] = [];
  return {
    sent,
    readyState: 1,
    send(data: string | ArrayBuffer | Uint8Array) {
      sent.push(data);
    },
  };
}

export function getSentJson(
  transport: ReturnType<typeof createMockTransport>,
): Record<string, unknown>[] {
  return transport.sent
    .filter((d): d is string => typeof d === "string")
    .map((s) => JSON.parse(s));
}

export function createMockSttHandle() {
  return {
    send: spy((_audio: Uint8Array) => {}),
    clear: spy(() => {}),
    close: spy(() => {}),
  };
}

export function createMockTtsClient() {
  const streamedText: string[] = [];
  return {
    streamedText,
    synthesizeStream: spy(
      async (
        chunks: string | AsyncIterable<string>,
        _onAudio: (chunk: Uint8Array) => void,
        _signal?: AbortSignal,
      ): Promise<void> => {
        if (typeof chunks === "string") {
          streamedText.push(chunks);
        } else {
          for await (const text of chunks) {
            streamedText.push(text);
          }
        }
      },
    ),
    close: spy(() => {}),
  };
}

export function createMockExecuteTool() {
  let mockResult = '"tool result"';
  const fn = spy(
    (_name: string, _args: Record<string, unknown>, _sessionId?: string) =>
      Promise.resolve(mockResult),
  );
  return {
    fn,
    get mockResult() {
      return mockResult;
    },
    set mockResult(v: string) {
      mockResult = v;
    },
  };
}

function createMockPlatformConfig(): PlatformConfig {
  return {
    apiKey: "test-api-key",
    sttConfig: { ...DEFAULT_STT_CONFIG },
    ttsConfig: { ...DEFAULT_TTS_CONFIG, apiKey: "test-tts-key" },
    model: "test-model",
    llmGatewayBase: "https://test-gateway.example.com/v1",
    braveApiKey: "",
  };
}

export function createMockLLMResponse(
  content: string | null,
  toolCalls?: {
    id: string;
    name: string;
    arguments: string;
  }[],
): LLMResponse {
  const message: ChatMessage = {
    role: "assistant",
    content,
  };
  if (toolCalls) {
    message.tool_calls = toolCalls.map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: { name: tc.name, arguments: tc.arguments },
    }));
  }
  return {
    choices: [
      {
        message,
        finish_reason: toolCalls ? "tool_calls" : "stop",
      },
    ],
  };
}

export { assertSpyCalls, resolvesNext } from "@std/testing/mock";

export function createMockSessionOptions(): {
  opts: SessionOptions;
  sttHandle: ReturnType<typeof createMockSttHandle>;
  ttsClient: ReturnType<typeof createMockTtsClient>;
  executeTool: ReturnType<typeof createMockExecuteTool>;
  llmCalls: {
    messages: ChatMessage[];
    tools: ToolSchema[];
  }[];
  llmResponses: LLMResponse[];
  mockCallLLM: (opts: CallLLMOptions) => Promise<LLMResponse>;
} {
  const sttHandle = createMockSttHandle();
  const ttsClient = createMockTtsClient();
  const executeTool = createMockExecuteTool();
  const llmCalls: { messages: ChatMessage[]; tools: ToolSchema[] }[] = [];
  const llmResponses: LLMResponse[] = [
    createMockLLMResponse("Hello from LLM"),
  ];
  const nextResponse = resolvesNext(llmResponses);

  const opts: SessionOptions = {
    id: "test-session-id",
    transport: createMockTransport(),
    agentConfig: {
      instructions: "Test instructions",
      greeting: "Hi there!",
      voice: "luna",
    },
    toolSchemas: [],
    platformConfig: createMockPlatformConfig(),
    executeTool: executeTool.fn,
  };

  return {
    opts,
    sttHandle,
    ttsClient,
    executeTool,
    llmCalls,
    llmResponses,
    get mockCallLLM() {
      return (callOpts: CallLLMOptions) => {
        llmCalls.push({
          messages: [...callOpts.messages],
          tools: callOpts.tools,
        });
        return nextResponse();
      };
    },
  } as ReturnType<typeof createMockSessionOptions>;
}

export function createMockSttEvents() {
  return {
    onSpeechStarted: spy(() => {}),
    onTranscript: spy(
      (_text: string, _isFinal: boolean, _turnOrder?: number) => {},
    ),
    onTurn: spy((_text: string, _turnOrder?: number) => {}),
    onTermination: spy(
      (_audioDuration: number, _sessionDuration: number) => {},
    ),
    onError: spy((_err: Error) => {}),
    onClose: spy(() => {}),
  };
}

// --- From _test_fixtures.ts ---

export const VALID_ENV = {
  ASSEMBLYAI_API_KEY: "test-key",
};

export function createTestStore(): BundleStore {
  return createBundleStore(createMemoryS3Client(), "test-bucket");
}

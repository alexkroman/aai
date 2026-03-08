import type { SessionOptions, SessionTransport } from "./session.ts";
import type { SttEvents, SttHandle } from "./stt.ts";
import type { ExecuteTool } from "../core/_worker_entry.ts";
import type { PlatformConfig } from "./config.ts";
import { resolvesNext } from "@std/testing/mock";
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

export function createMockSttHandle(): SttHandle & {
  sentData: Uint8Array[];
  clearCalled: boolean;
  closeCalled: boolean;
} {
  const sentData: Uint8Array[] = [];
  return {
    sentData,
    clearCalled: false,
    closeCalled: false,
    send(audio: Uint8Array) {
      sentData.push(audio);
    },
    clear() {
      this.clearCalled = true;
    },
    close() {
      this.closeCalled = true;
    },
  };
}

export type MockTtsClient = {
  synthesizeStreamCalls: number;
  streamedText: string[];
  closeCalled: boolean;
  synthesizeStream(
    chunks: string | AsyncIterable<string>,
    onAudio: (chunk: Uint8Array) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  close(): void;
};

export function createMockTtsClient(): MockTtsClient {
  return {
    synthesizeStreamCalls: 0,
    streamedText: [],
    closeCalled: false,
    async synthesizeStream(
      chunks: string | AsyncIterable<string>,
      _onAudio: (chunk: Uint8Array) => void,
      _signal?: AbortSignal,
    ): Promise<void> {
      this.synthesizeStreamCalls++;
      if (typeof chunks === "string") {
        this.streamedText.push(chunks);
      } else {
        for await (const text of chunks) {
          this.streamedText.push(text);
        }
      }
    },
    close() {
      this.closeCalled = true;
    },
  };
}

export type MockExecuteTool = {
  fn: ExecuteTool;
  calls: { name: string; args: Record<string, unknown> }[];
  mockResult: string;
};

export function createMockExecuteTool(): MockExecuteTool {
  const mock: MockExecuteTool = {
    fn: (name: string, args: Record<string, unknown>) => {
      mock.calls.push({ name, args });
      return Promise.resolve(mock.mockResult);
    },
    calls: [],
    mockResult: '"tool result"',
  };
  return mock;
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

export { resolvesNext } from "@std/testing/mock";

export function createMockSessionOptions(): {
  opts: SessionOptions;
  sttHandle: ReturnType<typeof createMockSttHandle>;
  ttsClient: ReturnType<typeof createMockTtsClient>;
  executeTool: MockExecuteTool;
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

export function createMockSttEvents(
  overrides?: Partial<SttEvents>,
): SttEvents & {
  transcripts: { text: string; isFinal: boolean; turnOrder?: number }[];
  turns: { text: string; turnOrder?: number }[];
  terminations: { audioDuration: number; sessionDuration: number }[];
  errors: Error[];
  closed: boolean;
} {
  const transcripts: { text: string; isFinal: boolean; turnOrder?: number }[] =
    [];
  const turns: { text: string; turnOrder?: number }[] = [];
  const terminations: { audioDuration: number; sessionDuration: number }[] = [];
  const errors: Error[] = [];
  let closed = false;

  return {
    transcripts,
    turns,
    terminations,
    errors,
    get closed() {
      return closed;
    },
    onSpeechStarted() {},
    onTranscript(text, isFinal, turnOrder) {
      transcripts.push({ text, isFinal, turnOrder });
    },
    onTurn(text, turnOrder) {
      turns.push({ text, turnOrder });
    },
    onTermination(audioDuration, sessionDuration) {
      terminations.push({ audioDuration, sessionDuration });
    },
    onError(err) {
      errors.push(err);
    },
    onClose() {
      closed = true;
    },
    ...overrides,
  };
}

// --- From _test_fixtures.ts ---

export const VALID_ENV = {
  ASSEMBLYAI_API_KEY: "test-key",
};

export function createTestStore(): BundleStore {
  return createBundleStore(createMemoryS3Client(), "test-bucket");
}

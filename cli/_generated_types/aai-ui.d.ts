// Keep in sync with ui/ source files.
// Provides type information for @aai/ui so IDE autocomplete works without
// fetching the JSR package.

declare module "@aai/ui" {
  /** Reactive value container (from @preact/signals). */
  interface Signal<T> {
    value: T;
    peek(): T;
    subscribe(fn: (value: T) => void): () => void;
  }

  export type AgentState =
    | "connecting"
    | "ready"
    | "listening"
    | "thinking"
    | "speaking"
    | "error";

  export type Message = {
    role: "user" | "assistant";
    text: string;
  };

  export type SessionErrorCode = "connection" | "audio" | "protocol";

  export type SessionError = {
    readonly code: SessionErrorCode;
    readonly message: string;
  };

  export type SessionOptions = {
    platformUrl: string;
  };

  export type VoiceSession = {
    readonly state: Signal<AgentState>;
    readonly messages: Signal<Message[]>;
    readonly transcript: Signal<string>;
    readonly error: Signal<SessionError | null>;
    readonly disconnected: Signal<{ intentional: boolean } | null>;
    connect(options?: { signal?: AbortSignal }): void;
    cancel(): void;
    resetState(): void;
    reset(): void;
    disconnect(): void;
    [Symbol.dispose](): void;
  };

  export type SessionSignals = {
    state: Signal<AgentState>;
    messages: Signal<Message[]>;
    transcript: Signal<string>;
    error: Signal<SessionError | null>;
    started: Signal<boolean>;
    running: Signal<boolean>;
    dispose(): void;
    start(): void;
    toggle(): void;
    reset(): void;
    [Symbol.dispose](): void;
  };

  export type Theme = {
    bg: string;
    surface: string;
    surfaceLight: string;
    primary: string;
    text: string;
    textMuted: string;
    error: string;
    font: string;
    radius: string;
    stateColors: Record<AgentState, string>;
  };

  export type MountOptions = {
    theme?: Partial<Theme>;
    target?: string | HTMLElement;
    platformUrl?: string;
  };

  export type MountHandle = {
    session: VoiceSession;
    signals: SessionSignals;
    dispose(): void;
    [Symbol.dispose](): void;
  };

  // --- Functions ---

  export function useSession(): SessionSignals;
  export function createSessionControls(session: VoiceSession): SessionSignals;
  export function createVoiceSession(options: SessionOptions): VoiceSession;
  export function mount(
    Component: import("preact").ComponentType,
    options?: MountOptions,
  ): MountHandle;

  export function applyTheme(
    el: HTMLElement,
    theme: Readonly<Theme>,
  ): void;

  export const defaultTheme: Theme;
  export const darkTheme: Theme;

  // --- Components ---

  export function SessionProvider(props: {
    value: SessionSignals;
    children: import("preact").ComponentChildren;
  }): import("preact").JSX.Element;

  export function App(): import("preact").JSX.Element;
  export function ChatView(): import("preact").JSX.Element;
  export function ErrorBanner(): import("preact").JSX.Element;
  export function MessageBubble(props: {
    msg: Message;
  }): import("preact").JSX.Element;
  export function StateIndicator(): import("preact").JSX.Element;
  export function ThinkingIndicator(): import("preact").JSX.Element;
  export function Transcript(): import("preact").JSX.Element;

  // --- CSS-in-JS (goober) ---

  export function css(
    tag: TemplateStringsArray,
    ...values: unknown[]
  ): string;

  export function keyframes(
    tag: TemplateStringsArray,
    ...values: unknown[]
  ): string;

  export function styled(
    tag: string | import("preact").ComponentType,
  ): (
    tag: TemplateStringsArray,
    ...values: unknown[]
  ) => import("preact").ComponentType;
}

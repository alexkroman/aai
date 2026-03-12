// Copyright 2025 the AAI authors. MIT license.
import type * as preact from "preact";
import { useRef } from "preact/hooks";
import { useComputed, useSignalEffect } from "@preact/signals";
import type { Signal } from "@preact/signals";
import type { AgentState, Message, SessionError } from "./types.ts";
import { useSession } from "./signals.ts";

// --- Bounce animation (injected once into document) ---

const BOUNCE_CSS = `
@keyframes aai-bounce {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1); }
}`;

let bounceInjected = false;
function ensureBounceCSS(): void {
  if (bounceInjected) return;
  bounceInjected = true;
  const style = document.createElement("style");
  style.textContent = BOUNCE_CSS;
  document.head.appendChild(style);
}

// --- Components ---

export function StateIndicator(
  { state }: { state: Signal<AgentState> },
): preact.JSX.Element {
  return (
    <div className="flex items-center gap-2 mb-4 shrink-0">
      <div
        className="w-3 h-3 rounded-full"
        style={{ background: `var(--aai-state-${state.value})` }}
      />
      <span
        className="text-sm capitalize"
        style={{ color: "var(--aai-text-muted)" }}
      >
        {state}
      </span>
    </div>
  );
}

export function ErrorBanner(
  { error }: { error: Signal<SessionError | null> },
): preact.JSX.Element | null {
  if (!error.value) return null;
  return (
    <div
      className="rounded-lg mb-4 text-sm px-3.5 py-2.5"
      style={{ background: "var(--aai-surface)", color: "var(--aai-error)" }}
    >
      {error.value.message}
    </div>
  );
}

export function MessageBubble(
  { message }: { message: Message },
): preact.JSX.Element {
  const isUser = message.role === "user";
  return (
    <div className={`mb-3 ${isUser ? "text-right" : "text-left"}`}>
      <div
        className="inline-block max-w-[80%] px-3 py-2 text-sm text-left"
        style={{
          borderRadius: "var(--aai-radius)",
          background: isUser
            ? "var(--aai-surface-light)"
            : "var(--aai-surface)",
        }}
      >
        <div>{message.text}</div>
      </div>
    </div>
  );
}

export function Transcript(
  { text }: { text: Signal<string> },
): preact.JSX.Element | null {
  if (!text.value) return null;
  return (
    <div className="mb-3 text-right">
      <div
        className="inline-block max-w-[80%] px-3 py-2 text-sm text-left opacity-60"
        style={{
          borderRadius: "var(--aai-radius)",
          background: "var(--aai-surface-light)",
        }}
      >
        <div>{text}</div>
      </div>
    </div>
  );
}

export function ThinkingIndicator(): preact.JSX.Element {
  ensureBounceCSS();
  return (
    <div className="flex items-center gap-1 px-3 py-2 mb-3">
      <div
        className="w-3 h-3 rounded-full"
        style={{
          background: "var(--aai-text-muted)",
          animation: "aai-bounce 1.4s infinite ease-in-out both",
          animationDelay: "0s",
        }}
      />
      <div
        className="w-3 h-3 rounded-full"
        style={{
          background: "var(--aai-text-muted)",
          animation: "aai-bounce 1.4s infinite ease-in-out both",
          animationDelay: "0.16s",
        }}
      />
      <div
        className="w-3 h-3 rounded-full"
        style={{
          background: "var(--aai-text-muted)",
          animation: "aai-bounce 1.4s infinite ease-in-out both",
          animationDelay: "0.32s",
        }}
      />
    </div>
  );
}

function MessageList() {
  const { messages, transcript, state } = useSession();
  const scrollRef = useRef<HTMLDivElement>(null);

  useSignalEffect(() => {
    messages.value;
    transcript.value;
    state.value;
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  });

  return (
    <div
      className="flex-1 min-h-[200px] overflow-y-auto mb-4 p-4 border"
      style={{
        borderColor: "var(--aai-surface-light)",
        borderRadius: "var(--aai-radius)",
        WebkitOverflowScrolling: "touch",
      }}
    >
      {messages.value.map((msg: Message, i: number) => (
        <MessageBubble key={i} message={msg} />
      ))}
      <Transcript text={transcript} />
      {state.value === "thinking" && <ThinkingIndicator />}
      <div ref={scrollRef} />
    </div>
  );
}

function Controls() {
  const { running, toggle, reset } = useSession();
  const primaryBg = useComputed(() =>
    running.value ? "var(--aai-error)" : "var(--aai-state-ready)"
  );

  return (
    <div className="flex gap-2 shrink-0 pb-[env(safe-area-inset-bottom,0)]">
      <button
        type="button"
        className="flex-1 px-4 py-3 border-none cursor-pointer text-[15px]"
        style={{
          borderRadius: "var(--aai-radius)",
          background: primaryBg.value,
          color: "var(--aai-text)",
          WebkitTapHighlightColor: "transparent",
        }}
        onClick={toggle}
      >
        {running.value ? "Stop" : "Resume"}
      </button>
      <button
        type="button"
        className="flex-1 px-4 py-3 bg-transparent cursor-pointer text-[15px] border"
        style={{
          borderRadius: "var(--aai-radius)",
          borderColor: "var(--aai-surface-light)",
          color: "var(--aai-text-muted)",
          WebkitTapHighlightColor: "transparent",
        }}
        onClick={reset}
      >
        New Conversation
      </button>
    </div>
  );
}

export function ChatView(): preact.JSX.Element {
  const { state, error } = useSession();

  return (
    <div
      className="max-w-[600px] mx-auto p-5 min-h-screen box-border flex flex-col"
      style={{ fontFamily: "var(--aai-font)", color: "var(--aai-text)" }}
    >
      <StateIndicator state={state} />
      <ErrorBanner error={error} />
      <MessageList />
      <Controls />
    </div>
  );
}

export function App(): preact.JSX.Element {
  const { started, start } = useSession();

  if (!started.value) {
    return (
      <div
        className="max-w-[600px] mx-auto p-5 flex items-center justify-center min-h-screen"
        style={{ fontFamily: "var(--aai-font)", color: "var(--aai-text)" }}
      >
        <button
          type="button"
          className="px-10 py-[18px] border-none text-lg font-medium cursor-pointer"
          style={{
            borderRadius: "var(--aai-radius)",
            background: "var(--aai-primary)",
            color: "var(--aai-text)",
            WebkitTapHighlightColor: "transparent",
          }}
          onClick={start}
        >
          Start Conversation
        </button>
      </div>
    );
  }

  return <ChatView />;
}

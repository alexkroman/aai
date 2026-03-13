// Copyright 2025 the AAI authors. MIT license.
import type * as preact from "preact";
import { useRef } from "preact/hooks";
import { useSignalEffect } from "@preact/signals";
import type { Signal } from "@preact/signals";
import type { AgentState, Message, SessionError } from "./types.ts";
import { useSession } from "./signals.ts";

// --- Components ---

export function StateIndicator(
  { state }: { state: Signal<AgentState> },
): preact.JSX.Element {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "6px",
        fontSize: "13px",
        fontWeight: 500,
        lineHeight: "130%",
        color: "rgba(255,255,255,0.284)",
        textTransform: "capitalize",
      }}
    >
      <div
        style={{
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          background: `var(--color-aai-state-${state.value})`,
        }}
      />
      {state}
    </div>
  );
}

export function ErrorBanner(
  { error }: { error: Signal<SessionError | null> },
): preact.JSX.Element | null {
  if (!error.value) return null;
  return (
    <div
      style={{
        margin: "12px 16px 0",
        padding: "8px 12px",
        borderRadius: "6px",
        border: "1px solid rgba(252,83,58,0.4)",
        background: "rgba(252,83,58,0.08)",
        fontSize: "13px",
        lineHeight: "130%",
        color: "#fc533a",
      }}
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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        alignSelf: "stretch",
        width: "100%",
      }}
    >
      <div
        style={{
          maxWidth: "min(82%, 64ch)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontSize: "14px",
          fontWeight: 400,
          lineHeight: "150%",
          color: "rgba(255,255,255,0.936)",
          ...(isUser
            ? {
              background: "rgba(255,255,255,0.031)",
              border: "1px solid #282828",
              padding: "8px 12px",
              borderRadius: "6px",
              marginLeft: "auto",
            }
            : {
              padding: "0",
            }),
        }}
      >
        {message.text}
      </div>
    </div>
  );
}

export function Transcript(
  { text }: { text: Signal<string> },
): preact.JSX.Element | null {
  if (!text.value) return null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        width: "100%",
      }}
    >
      <div
        style={{
          maxWidth: "min(82%, 64ch)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontSize: "14px",
          lineHeight: "150%",
          color: "rgba(255,255,255,0.284)",
          background: "rgba(255,255,255,0.031)",
          border: "1px solid #282828",
          padding: "8px 12px",
          borderRadius: "6px",
          marginLeft: "auto",
        }}
      >
        {text.value}
      </div>
    </div>
  );
}

export function ThinkingIndicator(): preact.JSX.Element {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        color: "rgba(255,255,255,0.422)",
        fontSize: "14px",
        fontWeight: 500,
        minHeight: "20px",
      }}
    >
      {[0, 0.16, 0.32].map((delay) => (
        <div
          key={delay}
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: "rgba(255,255,255,0.422)",
            animation: "aai-bounce 1.4s infinite ease-in-out both",
            animationDelay: `${delay}s`,
          }}
        />
      ))}
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
      role="log"
      style={{
        flex: 1,
        overflowY: "auto",
        scrollbarWidth: "none",
        WebkitOverflowScrolling: "touch",
        background: "#151515",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "18px",
          padding: "16px",
        }}
      >
        {messages.value.map((msg: Message, i: number) => (
          <MessageBubble key={i} message={msg} />
        ))}
        <Transcript text={transcript} />
        {state.value === "thinking" && <ThinkingIndicator />}
        <div ref={scrollRef} />
      </div>
    </div>
  );
}

function Controls() {
  const { running, toggle, reset } = useSession();

  const btnBase = {
    height: "32px",
    padding: "6px 12px",
    borderRadius: "6px",
    fontSize: "14px",
    fontWeight: 500,
    lineHeight: "130%",
    cursor: "pointer",
    border: "1px solid transparent",
    outline: "none",
  } as const;

  return (
    <div
      style={{
        display: "flex",
        gap: "8px",
        padding: "12px 16px",
        borderTop: "1px solid #282828",
        flexShrink: 0,
      }}
    >
      <button
        type="button"
        style={{
          ...btnBase,
          background: running.value ? "rgba(255,255,255,0.059)" : "#034cff",
          color: running.value ? "rgba(255,255,255,0.618)" : "#fff",
          borderColor: running.value ? "#282828" : "#034cff",
        }}
        onClick={toggle}
      >
        {running.value ? "Stop" : "Resume"}
      </button>
      <button
        type="button"
        style={{
          ...btnBase,
          background: "transparent",
          color: "rgba(255,255,255,0.618)",
          borderColor: "#282828",
        }}
        onClick={reset}
      >
        New Conversation
      </button>
    </div>
  );
}

function BodyStyle(): preact.JSX.Element {
  return (
    <>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
      />
      <style>html,body{"{"}margin:0;padding:0;background:#101010{"}"}</style>
    </>
  );
}

export function ChatView(): preact.JSX.Element {
  const { state, error } = useSession();

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        maxWidth: "520px",
        margin: "0 auto",
        background: "#101010",
        color: "rgba(255,255,255,0.936)",
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        fontSize: "14px",
      }}
    >
      <BodyStyle />
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          padding: "12px 16px",
          borderBottom: "1px solid #282828",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: "10px",
            lineHeight: 1.1,
            fontWeight: 700,
            color: "#9dbefe",
            whiteSpace: "pre",
          }}
        >
          ▄▀█ ▄▀█ █ █▀█ █▀█ █
        </span>
        <div style={{ marginLeft: "auto" }}>
          <StateIndicator state={state} />
        </div>
      </div>
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
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background: "#101010",
          fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        }}
      >
        <BodyStyle />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "24px",
            background: "#151515",
            border: "1px solid #282828",
            borderRadius: "8px",
            padding: "40px 48px",
          }}
        >
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: "18px",
              lineHeight: 1.1,
              fontWeight: 700,
              color: "#9dbefe",
              whiteSpace: "pre",
            }}
          >
            ▄▀█ ▄▀█ █ █▀█ █▀█ █
          </span>
          <button
            type="button"
            style={{
              height: "32px",
              padding: "6px 16px",
              borderRadius: "6px",
              fontSize: "14px",
              fontWeight: 500,
              lineHeight: "130%",
              cursor: "pointer",
              background: "rgba(255,255,255,0.059)",
              color: "rgba(255,255,255,0.618)",
              border: "1px solid #282828",
              outline: "none",
            }}
            onClick={start}
          >
            Start
          </button>
        </div>
      </div>
    );
  }

  return <ChatView />;
}

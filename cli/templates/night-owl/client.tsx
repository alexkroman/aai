import {
  ErrorBanner,
  MessageBubble,
  mount,
  StateIndicator,
  Transcript,
  useSession,
} from "@jsr/aai__ui";
import type { Message } from "@jsr/aai__ui";
import { useEffect, useRef } from "preact/hooks";

function NightOwl() {
  const {
    state,
    messages,
    transcript,
    error,
    started,
    running,
    start,
    toggle,
    reset,
  } = useSession();
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.value.length, transcript.value]);

  if (!started.value) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          gap: "24px",
        }}
      >
        <div style={{ fontSize: "3rem" }}>&#x1F989;</div>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>
          Night Owl
        </h1>
        <p
          style={{
            fontSize: "0.875rem",
            margin: 0,
            color: "var(--aai-text-muted)",
          }}
        >
          your evening companion
        </p>
        <button
          type="button"
          style={{
            marginTop: "16px",
            padding: "14px 36px",
            border: "none",
            fontWeight: 500,
            fontSize: "15px",
            cursor: "pointer",
            letterSpacing: "0.025em",
            background: "var(--aai-primary)",
            color: "var(--aai-text)",
            borderRadius: "var(--aai-radius)",
          }}
          onClick={start}
        >
          Start Conversation
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        maxWidth: "640px",
        margin: "0 auto",
        padding: "24px",
        minHeight: "100vh",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          marginBottom: "20px",
          paddingBottom: "16px",
          borderBottom: "1px solid var(--aai-surface-light)",
        }}
      >
        <div style={{ fontSize: "1.25rem" }}>&#x1F989;</div>
        <span style={{ fontSize: "1rem", fontWeight: 600 }}>Night Owl</span>
        <div style={{ marginLeft: "auto" }}>
          <StateIndicator state={state} />
        </div>
      </div>

      <ErrorBanner error={error} />

      <div
        style={{
          minHeight: "300px",
          maxHeight: "500px",
          overflowY: "auto",
          marginBottom: "16px",
          padding: "16px",
          border: "1px solid var(--aai-surface-light)",
          borderRadius: "var(--aai-radius)",
          background: "var(--aai-surface)",
        }}
      >
        {messages.value.map((msg: Message, i: number) => (
          <MessageBubble key={i} message={msg} />
        ))}
        <Transcript text={transcript} />
        <div ref={bottom} />
      </div>

      <div style={{ display: "flex", gap: "8px" }}>
        <button
          type="button"
          style={{
            padding: "10px 20px",
            border: "none",
            fontWeight: 500,
            fontSize: "13px",
            cursor: "pointer",
            borderRadius: "var(--aai-radius)",
            color: "var(--aai-bg)",
            background: running.value
              ? "var(--aai-state-speaking)"
              : "var(--aai-state-ready)",
          }}
          onClick={toggle}
        >
          {running.value ? "Stop" : "Resume"}
        </button>
        <button
          type="button"
          style={{
            padding: "10px 20px",
            background: "transparent",
            fontWeight: 500,
            fontSize: "13px",
            cursor: "pointer",
            borderRadius: "var(--aai-radius)",
            border: "1px solid var(--aai-surface-light)",
            color: "var(--aai-text-muted)",
          }}
          onClick={reset}
        >
          New Conversation
        </button>
      </div>
    </div>
  );
}

mount(NightOwl);

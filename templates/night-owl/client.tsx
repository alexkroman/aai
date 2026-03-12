import {
  ErrorBanner,
  MessageBubble,
  StateIndicator,
  Transcript,
  useSession,
} from "@jsr/aai__ui";
import type { Message } from "@jsr/aai__ui";
import { useEffect, useRef } from "preact/hooks";

export default function NightOwl() {
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
      <div className="flex flex-col items-center justify-center min-h-screen gap-6">
        <div className="text-5xl">&#x1F989;</div>
        <h1 className="text-2xl font-semibold m-0">Night Owl</h1>
        <p
          className="text-sm m-0"
          style={{ color: "var(--aai-text-muted)" }}
        >
          your evening companion
        </p>
        <button
          type="button"
          className="mt-4 px-9 py-3.5 border-none font-medium text-[15px] cursor-pointer tracking-wide"
          style={{
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
    <div className="max-w-[640px] mx-auto p-6 min-h-screen">
      <div
        className="flex items-center gap-2.5 mb-5 pb-4"
        style={{ borderBottom: "1px solid var(--aai-surface-light)" }}
      >
        <div className="text-xl">&#x1F989;</div>
        <span className="text-base font-semibold">Night Owl</span>
        <div className="ml-auto">
          <StateIndicator state={state} />
        </div>
      </div>

      <ErrorBanner error={error} />

      <div
        className="min-h-[300px] max-h-[500px] overflow-y-auto mb-4 p-4"
        style={{
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

      <div className="flex gap-2">
        <button
          type="button"
          className="px-5 py-2.5 border-none font-medium text-[13px] cursor-pointer"
          style={{
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
          className="px-5 py-2.5 bg-transparent font-medium text-[13px] cursor-pointer"
          style={{
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

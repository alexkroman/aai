// Copyright 2025 the AAI authors. MIT license.
import type * as preact from "preact";
import { useRef } from "preact/hooks";
import { useComputed, useSignalEffect } from "@preact/signals";
import type { Signal } from "@preact/signals";
import type { AgentState, Message, SessionError } from "./types.ts";
import { useSession } from "./signals.ts";
import { Alert } from "./primitives/alert.tsx";
import { Badge } from "./primitives/badge.tsx";
import { Button } from "./primitives/button.tsx";
import { Card } from "./primitives/card.tsx";
import { ScrollArea } from "./primitives/scroll-area.tsx";
import { cn } from "./primitives/cn.ts";

// --- Components ---

export function StateIndicator(
  { state }: { state: Signal<AgentState> },
): preact.JSX.Element {
  return (
    <Badge className="mb-4 shrink-0">
      <div
        className="w-3 h-3 rounded-full"
        style={{ background: `var(--aai-state-${state.value})` }}
      />
      {state}
    </Badge>
  );
}

export function ErrorBanner(
  { error }: { error: Signal<SessionError | null> },
): preact.JSX.Element | null {
  if (!error.value) return null;
  return (
    <Alert variant="destructive" className="mb-4">
      {error.value.message}
    </Alert>
  );
}

export function MessageBubble(
  { message }: { message: Message },
): preact.JSX.Element {
  const isUser = message.role === "user";
  return (
    <div className={cn("mb-3", isUser ? "text-right" : "text-left")}>
      <Card
        className={cn(
          "inline-block max-w-[80%] border-none text-left shadow-none",
          isUser ? "bg-aai-surface-light" : "bg-aai-surface",
        )}
      >
        <div className="px-3 py-2 text-sm">
          {message.text}
        </div>
      </Card>
    </div>
  );
}

export function Transcript(
  { text }: { text: Signal<string> },
): preact.JSX.Element | null {
  if (!text.value) return null;
  return (
    <div className="mb-3 text-right">
      <Card className="inline-block max-w-[80%] border-none bg-aai-surface-light opacity-60 text-left shadow-none">
        <div className="px-3 py-2 text-sm">
          {text}
        </div>
      </Card>
    </div>
  );
}

export function ThinkingIndicator(): preact.JSX.Element {
  return (
    <div className="flex items-center gap-1 px-3 py-2 mb-3">
      {[0, 0.16, 0.32].map((delay) => (
        <div
          key={delay}
          className="w-3 h-3 rounded-full bg-aai-text-muted"
          style={{
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
    <ScrollArea className="flex-1 min-h-[200px] mb-4 p-4 border border-aai-surface-light rounded-aai">
      {messages.value.map((msg: Message, i: number) => (
        <MessageBubble key={i} message={msg} />
      ))}
      <Transcript text={transcript} />
      {state.value === "thinking" && <ThinkingIndicator />}
      <div ref={scrollRef} />
    </ScrollArea>
  );
}

function Controls() {
  const { running, toggle, reset } = useSession();
  const variant = useComputed(() =>
    running.value ? "destructive" as const : "default" as const
  );

  return (
    <div className="flex gap-2 shrink-0 pb-[env(safe-area-inset-bottom,0)]">
      <Button
        variant={variant.value}
        className="flex-1 py-3"
        onClick={toggle}
      >
        {running.value ? "Stop" : "Resume"}
      </Button>
      <Button
        variant="outline"
        className="flex-1 py-3"
        onClick={reset}
      >
        New Conversation
      </Button>
    </div>
  );
}

export function ChatView(): preact.JSX.Element {
  const { state, error } = useSession();

  return (
    <div className="max-w-[600px] mx-auto p-5 min-h-screen box-border flex flex-col font-aai text-aai-text">
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
      <div className="max-w-[600px] mx-auto p-5 flex items-center justify-center min-h-screen font-aai text-aai-text">
        <Button size="lg" onClick={start}>
          Start Conversation
        </Button>
      </div>
    );
  }

  return <ChatView />;
}

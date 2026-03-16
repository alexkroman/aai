// Copyright 2025 the AAI authors. MIT license.
import { useRef } from "preact/hooks";
import { computed, useSignalEffect } from "@preact/signals";
import { useSession } from "../signals.ts";
import { MessageBubble } from "./message_bubble.tsx";
import { ToolCallBlock } from "./tool_call_block.tsx";
import { Transcript } from "./transcript.tsx";
import { ThinkingIndicator } from "./thinking_indicator.tsx";

export function MessageList() {
  const { session } = useSession();
  const scrollRef = useRef<HTMLDivElement>(null);

  const showThinking = computed(() => {
    if (session.state.value !== "thinking") return false;
    const last = session.toolCalls.value.at(-1);
    if (last?.status === "pending") return false;
    const lastMsg = session.messages.value.at(-1);
    return !lastMsg || lastMsg.role === "user" || !!last;
  });

  useSignalEffect(() => {
    session.messages.value;
    session.toolCalls.value;
    session.userUtterance.value;
    session.state.value;
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  });

  const messages = session.messages.value;
  const toolCalls = session.toolCalls.value;

  // Split: all messages except the last assistant, then tool calls, then last assistant.
  const lastMsg = messages.at(-1);
  const hasTrailingAssistant = lastMsg?.role === "assistant" &&
    toolCalls.length > 0;
  const topMessages = hasTrailingAssistant ? messages.slice(0, -1) : messages;

  return (
    <div
      role="log"
      class="flex-1 overflow-y-auto [scrollbar-width:none] bg-aai-surface"
    >
      <div class="flex flex-col gap-4.5 p-4">
        {topMessages.map((m, i) => <MessageBubble key={i} message={m} />)}
        {toolCalls.map((tc) => (
          <ToolCallBlock key={tc.toolCallId} toolCall={tc} />
        ))}
        {hasTrailingAssistant && (
          <MessageBubble
            key={messages.length - 1}
            message={lastMsg!}
          />
        )}
        <Transcript userUtterance={session.userUtterance} />
        {showThinking.value && <ThinkingIndicator />}
        <div ref={scrollRef} />
      </div>
    </div>
  );
}

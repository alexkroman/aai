// Copyright 2025 the AAI authors. MIT license.
import type { VNode } from "preact";
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

  // Group tool calls by the message index they follow.
  const toolCallsByIndex = new Map<number, typeof toolCalls>();
  for (const tc of toolCalls) {
    const idx = tc.afterMessageIndex;
    const group = toolCallsByIndex.get(idx);
    if (group) group.push(tc);
    else toolCallsByIndex.set(idx, [tc]);
  }

  // Interleave messages and tool calls. For each message, render it first,
  // then any tool calls that belong after it — so tool calls always appear
  // above the next assistant message (the text being spoken).
  const items: VNode[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    // Render tool calls *before* the assistant message they precede
    const tcs = toolCallsByIndex.get(i - 1);
    if (m.role === "assistant" && tcs) {
      for (const tc of tcs) {
        items.push(<ToolCallBlock key={tc.toolCallId} toolCall={tc} />);
      }
      toolCallsByIndex.delete(i - 1);
    }
    items.push(<MessageBubble key={`msg-${i}`} message={m} />);
  }
  // Render any remaining tool calls (e.g. from the last message, still pending)
  const trailing = toolCallsByIndex.get(messages.length - 1);
  if (trailing) {
    for (const tc of trailing) {
      items.push(<ToolCallBlock key={tc.toolCallId} toolCall={tc} />);
    }
  }

  return (
    <div
      role="log"
      class="flex-1 overflow-y-auto [scrollbar-width:none] bg-aai-surface"
    >
      <div class="flex flex-col gap-4.5 p-4">
        {items}
        <Transcript userUtterance={session.userUtterance} />
        {showThinking.value && <ThinkingIndicator />}
        <div ref={scrollRef} />
      </div>
    </div>
  );
}

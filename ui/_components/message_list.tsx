// Copyright 2025 the AAI authors. MIT license.
import { useRef } from "preact/hooks";
import { useSignalEffect } from "@preact/signals";
import type { Message, ToolCallInfo } from "../types.ts";
import { useSession } from "../signals.ts";
import { MessageBubble } from "./message_bubble.tsx";
import { ToolCallBlock } from "./tool_call_block.tsx";
import { Transcript } from "./transcript.tsx";
import { ThinkingIndicator } from "./thinking_indicator.tsx";

/** Interleave messages and tool calls for display. */
type DisplayItem =
  | { kind: "message"; message: Message; index: number }
  | { kind: "tool"; toolCall: ToolCallInfo };

function buildDisplayItems(
  messages: Message[],
  toolCalls: ToolCallInfo[],
): DisplayItem[] {
  const items: DisplayItem[] = [];
  // Group tool calls by afterMessageIndex
  const toolsByIndex = new Map<number, ToolCallInfo[]>();
  for (const tc of toolCalls) {
    const list = toolsByIndex.get(tc.afterMessageIndex) ?? [];
    list.push(tc);
    toolsByIndex.set(tc.afterMessageIndex, list);
  }
  // Tool calls before any messages (afterMessageIndex = -1)
  for (const tc of toolsByIndex.get(-1) ?? []) {
    items.push({ kind: "tool", toolCall: tc });
  }
  for (let i = 0; i < messages.length; i++) {
    items.push({ kind: "message", message: messages[i]!, index: i });
    for (const tc of toolsByIndex.get(i) ?? []) {
      items.push({ kind: "tool", toolCall: tc });
    }
  }
  return items;
}

export function MessageList() {
  const { messages, toolCalls, transcript, state } = useSession();
  const scrollRef = useRef<HTMLDivElement>(null);

  useSignalEffect(() => {
    messages.value;
    toolCalls.value;
    transcript.value;
    state.value;
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  });

  const items = buildDisplayItems(messages.value, toolCalls.value);

  return (
    <div
      role="log"
      class="flex-1 overflow-y-auto [scrollbar-width:none] bg-aai-surface"
    >
      <div class="flex flex-col gap-4.5 p-4">
        {items.map((item) =>
          item.kind === "tool"
            ? (
              <ToolCallBlock
                key={item.toolCall.toolCallId}
                toolCall={item.toolCall}
              />
            )
            : <MessageBubble key={item.index} message={item.message} />
        )}
        <Transcript text={transcript} />
        {state.value === "thinking" &&
          (() => {
            const last = toolCalls.value[toolCalls.value.length - 1];
            const lastMsg = messages.value[messages.value.length - 1];
            // Hide thinking dots when a tool call is pending (the block shows activity)
            if (last && last.status === "pending") return false;
            // Show when no messages, last is from user, or last tool call finished
            return !lastMsg || lastMsg.role === "user" || !!last;
          })() && <ThinkingIndicator />}
        <div ref={scrollRef} />
      </div>
    </div>
  );
}

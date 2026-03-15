// Copyright 2025 the AAI authors. MIT license.
import type * as preact from "preact";
import type { Signal } from "@preact/signals";
import { ThinkingIndicator } from "./thinking_indicator.tsx";

/** Sentinel value from ClientHandler indicating speech detected but no text yet. */
const SPEECH_ACTIVE = "\x00";

export function Transcript(
  { text }: { text: Signal<string> },
): preact.JSX.Element | null {
  if (!text.value) return null;
  return (
    <div class="flex flex-col items-end w-full">
      <div class="max-w-[min(82%,64ch)] whitespace-pre-wrap wrap-break-word text-sm leading-[150%] text-aai-text-muted bg-aai-surface-faint border border-aai-border px-3 py-2 rounded-aai ml-auto">
        {text.value === SPEECH_ACTIVE ? <ThinkingIndicator /> : text.value}
      </div>
    </div>
  );
}

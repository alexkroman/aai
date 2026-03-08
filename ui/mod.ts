/** @module @aai/ui */

export { css, keyframes, styled } from "goober";

export { createVoiceSession } from "@aai/ui/session";
export type { VoiceSession } from "@aai/ui/session";
export type {
  AgentState,
  Message,
  SessionError,
  SessionErrorCode,
  SessionOptions,
} from "@aai/ui/types";

export {
  createSessionControls,
  SessionProvider,
  useSession,
} from "@aai/ui/signals";
export type { SessionSignals } from "@aai/ui/signals";

export { applyTheme, darkTheme, defaultTheme } from "@aai/ui/theme";
export type { Theme } from "@aai/ui/theme";

export { mount } from "@aai/ui/mount";
export type { MountHandle, MountOptions } from "@aai/ui/mount";

export {
  App,
  ChatView,
  ErrorBanner,
  MessageBubble,
  StateIndicator,
  ThinkingIndicator,
  Transcript,
} from "@aai/ui/components";

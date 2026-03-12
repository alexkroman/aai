// Copyright 2025 the AAI authors. MIT license.
/**
 * Browser client library for AAI voice agents.
 *
 * Provides WebSocket session management, audio capture/playback,
 * Preact UI components, and theming.
 *
 * @example
 * ```ts
 * import { App, mount } from "@aai/ui";
 *
 * mount(App, { target: "#app" });
 * ```
 *
 * @module
 */

export { html } from "./_html.ts";

export { createVoiceSession } from "./session.ts";
export type { VoiceSession } from "./session.ts";
export type {
  AgentState,
  Message,
  SessionError,
  SessionErrorCode,
  SessionOptions,
} from "./types.ts";

export {
  createSessionControls,
  SessionProvider,
  useSession,
} from "./signals.ts";
export type { SessionSignals } from "./signals.ts";

export { applyTheme, darkTheme, defaultTheme, lightTheme } from "./theme.ts";
export type { Theme } from "./theme.ts";

export { mount } from "./mount.ts";
export type { MountHandle, MountOptions } from "./mount.ts";

export {
  App,
  ChatView,
  ErrorBanner,
  MessageBubble,
  StateIndicator,
  ThinkingIndicator,
  Transcript,
} from "./components.ts";

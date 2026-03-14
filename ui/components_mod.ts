// Copyright 2025 the AAI authors. MIT license.
/**
 * Preact UI components for AAI voice agents.
 *
 * Provides ready-made components, session context, and mount helpers.
 *
 * @example
 * ```tsx
 * import { App, mount } from "@aai/ui/components";
 *
 * mount(App, { target: "#app" });
 * ```
 *
 * @module
 */

export {
  createSessionControls,
  SessionProvider,
  useSession,
} from "./signals.ts";
export type { SessionSignals } from "./signals.ts";

export { mount } from "./mount.tsx";
export type { MountHandle, MountOptions } from "./mount.tsx";

export {
  App,
  ChatView,
  ErrorBanner,
  MessageBubble,
  StateIndicator,
  ThinkingIndicator,
  Transcript,
} from "./components.ts";

// Copyright 2025 the AAI authors. MIT license.
import type * as preact from "preact";
import { createContext, h } from "preact";
import { useContext } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { batch, effect, type Signal, signal } from "@preact/signals";
import type { VoiceSession } from "./session.ts";

import type { AgentState, Message, SessionError } from "./types.ts";

/**
 * Reactive session controls wrapping a {@linkcode VoiceSession} with Preact signals.
 *
 * Provides higher-level start/toggle/reset controls suitable for binding
 * to UI components, plus a `dispose` method for cleanup.
 */
export type SessionSignals = {
  /** Current agent state signal. */
  state: Signal<AgentState>;
  /** Chat message history signal. */
  messages: Signal<Message[]>;
  /** Live partial transcript signal. */
  transcript: Signal<string>;
  /** Current error signal, or `null` if no error. */
  error: Signal<SessionError | null>;
  /** Whether the session has been started by the user. */
  started: Signal<boolean>;
  /** Whether the session is currently running (connected or connecting). */
  running: Signal<boolean>;
  /** Dispose the reactive effect that tracks error state. */
  dispose(): void;
  /** Start the session for the first time (sets `started` and `running`). */
  start(): void;
  /** Toggle between connected and disconnected states. */
  toggle(): void;
  /** Reset the session: clear state and reconnect. */
  reset(): void;
  /** Alias for {@linkcode dispose} for use with `using`. */
  [Symbol.dispose](): void;
};

/**
 * Wrap a {@linkcode VoiceSession} in Preact signals for reactive UI binding.
 *
 * Creates higher-level controls (start, toggle, reset) on top of the raw
 * session, and automatically sets `running` to `false` when the session
 * enters an error state.
 *
 * @param session - The voice session to wrap.
 * @returns A {@linkcode SessionSignals} object for use in Preact components.
 */
export function createSessionControls(session: VoiceSession): SessionSignals {
  const started = signal(false);
  const running = signal(true);

  const dispose = effect(() => {
    if (session.state.value === "error") running.value = false;
  });

  return {
    state: session.state,
    messages: session.messages,
    transcript: session.transcript,
    error: session.error,
    started,
    running,
    dispose,
    start() {
      batch(() => {
        started.value = true;
        running.value = true;
      });
      session.connect();
    },
    toggle() {
      if (running.value) session.disconnect();
      else session.connect();
      running.value = !running.value;
    },
    reset() {
      session.reset();
    },
    [Symbol.dispose]() {
      dispose();
    },
  };
}

const Ctx = createContext<SessionSignals | null>(null);

/**
 * Preact context provider that makes session signals available to descendant
 * components via {@linkcode useSession}.
 *
 * @param props - Provider props.
 * @param props.value - The session signals to provide.
 * @param props.children - Child components that may consume the context.
 * @returns A Preact VNode wrapping children in the session context.
 */
export function SessionProvider(
  { value, children }: { value: SessionSignals; children: ComponentChildren },
): preact.JSX.Element {
  return h(Ctx.Provider, { value }, children);
}

/**
 * Hook to access session signals from within a {@linkcode SessionProvider}.
 *
 * @returns The {@linkcode SessionSignals} from the nearest provider.
 * @throws {Error} If called outside of a `SessionProvider`.
 */
export function useSession(): SessionSignals {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("Hook useSession() requires a SessionProvider");
  return ctx;
}

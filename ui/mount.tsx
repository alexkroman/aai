// Copyright 2025 the AAI authors. MIT license.
import { render } from "preact";
import type { ComponentType } from "preact";
import { createVoiceSession, type VoiceSession } from "./session.ts";
import {
  createSessionControls,
  SessionProvider,
  type SessionSignals,
} from "./signals.ts";
import { applyTheme, defaultTheme, type Theme } from "./theme.ts";

function injectBodyStyle(theme: Theme): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent =
    `body { margin: 0; padding: 0; background: ${theme.bg}; }`;
  document.head.appendChild(style);
  document.body.classList.add("m-0", "p-0");
  return style;
}

/** Options for {@linkcode mount}. */
export type MountOptions = {
  /** Partial theme overrides merged with the default theme. */
  theme?: Partial<Theme>;
  /** CSS selector or DOM element to render into. Defaults to `"#app"`. */
  target?: string | HTMLElement;
  /** Base URL of the AAI platform server. Falls back to `__AAI_BASE__` global. */
  platformUrl?: string;
};

/**
 * Handle returned by {@linkcode mount} for cleanup.
 *
 * Implements {@linkcode Disposable} so it can be used with `using`.
 */
export type MountHandle = {
  /** The underlying voice session. */
  session: VoiceSession;
  /** Reactive session controls for the mounted UI. */
  signals: SessionSignals;
  /** Unmount the UI, remove injected styles, and disconnect the session. */
  dispose(): void;
  /** Alias for {@linkcode dispose} for use with `using`. */
  [Symbol.dispose](): void;
};

function resolveContainer(target: string | HTMLElement = "#app"): HTMLElement {
  const el = typeof target === "string"
    ? document.querySelector(target)
    : target;
  if (!el) throw new Error(`Element not found: ${target}`);
  return el as HTMLElement;
}

/**
 * Mount a Preact component with voice session wiring and theming.
 *
 * Creates a {@linkcode VoiceSession}, wraps it in
 * {@linkcode SessionSignals}, applies the theme, and renders the component
 * inside a {@linkcode SessionProvider}.
 *
 * @param Component - The Preact component to render.
 * @param options - Mount options (theme, target element, platform URL).
 * @returns A {@linkcode MountHandle} for cleanup.
 * @throws {Error} If the target element is not found in the DOM.
 * @throws {Error} If `platformUrl` is not provided and `__AAI_BASE__` global is missing.
 */
export function mount(
  Component: ComponentType,
  options?: MountOptions,
): MountHandle {
  const container = resolveContainer(options?.target);
  const theme = { ...defaultTheme, ...options?.theme };
  applyTheme(container, theme);

  const injectedBase = (globalThis as unknown as Record<string, unknown>)
    .__AAI_BASE__ as
      | string
      | undefined;
  if (!options?.platformUrl && !injectedBase) {
    throw new Error("Missing __AAI_BASE__ global — the server must inject it");
  }
  const platformUrl = options?.platformUrl ??
    globalThis.location.origin + injectedBase;
  const session = createVoiceSession({ platformUrl });
  const signals = createSessionControls(session);
  const styleEl = injectBodyStyle(theme);

  render(
    <SessionProvider value={signals}>
      <Component />
    </SessionProvider>,
    container,
  );

  const handle: MountHandle = {
    session,
    signals,
    dispose() {
      render(null, container);
      styleEl.remove();
      signals.dispose();
      session.disconnect();
    },
    [Symbol.dispose]() {
      handle.dispose();
    },
  };
  return handle;
}

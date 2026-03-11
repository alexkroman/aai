import { h, render } from "preact";
import type { ComponentType } from "preact";
import { createPortal } from "preact/compat";
import { createVoiceSession, type VoiceSession } from "./session.ts";
import {
  createSessionControls,
  SessionProvider,
  type SessionSignals,
} from "./signals.ts";
import { applyTheme, defaultTheme, type Theme } from "./theme.ts";

function BodyStyle({ theme }: { theme: Theme }): ReturnType<typeof h> {
  return createPortal(
    h("style", null, `body { margin: 0; background: ${theme.bg}; }`),
    document.head,
  );
}

export type MountOptions = {
  theme?: Partial<Theme>;
  target?: string | HTMLElement;
  platformUrl?: string;
};

export type MountHandle = {
  session: VoiceSession;
  signals: SessionSignals;
  dispose(): void;
  [Symbol.dispose](): void;
};

function resolveContainer(target: string | HTMLElement = "#app"): HTMLElement {
  const el = typeof target === "string"
    ? document.querySelector(target)
    : target;
  if (!el) throw new Error(`Element not found: ${target}`);
  return el as HTMLElement;
}

export function mount(
  Component: ComponentType,
  options?: MountOptions,
): MountHandle {
  const container = resolveContainer(options?.target);
  const theme = { ...defaultTheme, ...options?.theme };
  applyTheme(container, theme);

  const platformUrl = options?.platformUrl ??
    new URL(".", globalThis.location.href).href.replace(/\/$/, "");
  const session = createVoiceSession({ platformUrl });
  const signals = createSessionControls(session);

  render(
    h(SessionProvider, {
      value: signals,
      children: [h(BodyStyle, { theme }), h(Component, null)],
    }),
    container,
  );

  const handle: MountHandle = {
    session,
    signals,
    dispose() {
      render(null, container);
      signals.dispose();
      session.disconnect();
    },
    [Symbol.dispose]() {
      handle.dispose();
    },
  };
  return handle;
}

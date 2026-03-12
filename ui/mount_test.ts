// Copyright 2025 the AAI authors. MIT license.
import {
  assert,
  assertStrictEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { withMountEnv } from "./_test_utils.ts";
import { mount } from "./mount.ts";
import { defaultTheme } from "./theme.ts";
import { html } from "./_html.ts";

Deno.test("mount()", async (t) => {
  await t.step(
    "throws when target selector does not match",
    withMountEnv(() => {
      function App() {
        return html`
          <div>test</div>
        `;
      }
      assertThrows(
        () =>
          mount(App, {
            target: "#nonexistent",
            platformUrl: "http://localhost:3000",
          }),
        Error,
        "Element not found: #nonexistent",
      );
    }),
  );

  await t.step(
    "renders a component into the default #app element",
    withMountEnv(() => {
      function App() {
        return html`
          <div class="hello">Hello Mount</div>
        `;
      }
      mount(App, { platformUrl: "http://localhost:3000" });

      const el = globalThis.document.querySelector("#app")!;
      assertStringIncludes(el.textContent!, "Hello Mount");
    }),
  );

  await t.step(
    "returns session, signals, and dispose",
    withMountEnv(() => {
      function App() {
        return html`
          <div />
        `;
      }
      const handle = mount(App, { platformUrl: "http://localhost:3000" });

      assert(handle.session !== undefined);
      assert(handle.signals !== undefined);
      assertStrictEquals(typeof handle.dispose, "function");
    }),
  );

  await t.step(
    "applies theme CSS variables to the container",
    withMountEnv(() => {
      function App() {
        return html`
          <div />
        `;
      }
      mount(App, { platformUrl: "http://localhost:3000" });

      const el = globalThis.document.querySelector("#app") as HTMLElement;
      // deno-lint-ignore no-explicit-any
      const bg = (el.style as any).getPropertyValue("--aai-bg");
      assertStrictEquals(bg, defaultTheme.bg);
      // deno-lint-ignore no-explicit-any
      const primary = (el.style as any).getPropertyValue("--aai-primary");
      assertStrictEquals(primary, defaultTheme.primary);
    }),
  );

  await t.step(
    "merges custom theme with defaults",
    withMountEnv(() => {
      function App() {
        return html`
          <div />
        `;
      }
      mount(App, {
        platformUrl: "http://localhost:3000",
        theme: { bg: "#000000", primary: "#ff0000" },
      });

      const el = globalThis.document.querySelector("#app") as HTMLElement;
      // deno-lint-ignore no-explicit-any
      const bg = (el.style as any).getPropertyValue("--aai-bg");
      assertStrictEquals(bg, "#000000");
      // deno-lint-ignore no-explicit-any
      const primary = (el.style as any).getPropertyValue("--aai-primary");
      assertStrictEquals(primary, "#ff0000");
      // deno-lint-ignore no-explicit-any
      const surface = (el.style as any).getPropertyValue("--aai-surface");
      assertStrictEquals(surface, defaultTheme.surface);
    }),
  );

  await t.step(
    "dispose tears down render and disconnects session",
    withMountEnv(() => {
      function App() {
        return html`
          <div>content</div>
        `;
      }
      const handle = mount(App, { platformUrl: "http://localhost:3000" });

      const el = globalThis.document.querySelector("#app")!;
      assertStringIncludes(el.textContent!, "content");

      handle.dispose();
      assertStrictEquals(el.textContent, "");
    }),
  );

  await t.step(
    "reads __AAI_BASE__ for platformUrl when not explicitly provided",
    withMountEnv(async (mock) => {
      // deno-lint-ignore no-explicit-any
      const g = globalThis as any;
      g.__AAI_BASE__ = "/alex/ai-takes";
      g.location = { origin: "https://aai-agent.fly.dev", pathname: "/" };
      const App = () =>
        html`
          <div />
        `;
      try {
        const handle = mount(App);
        // Session connects on start — trigger it and flush microtasks
        handle.session.connect();
        await new Promise<void>((r) => setTimeout(r, 0));
        const ws = mock.lastWs!;
        assertStrictEquals(
          ws.url.toString(),
          "wss://aai-agent.fly.dev/alex/ai-takes/websocket",
        );
        handle.dispose();
      } finally {
        delete g.__AAI_BASE__;
      }
    }),
  );
});

// Copyright 2025 the AAI authors. MIT license.
import { assertStrictEquals } from "@std/assert";
import { applyTheme, darkTheme, defaultTheme, lightTheme } from "./theme.ts";

function mockElement(): { el: HTMLElement; props: Map<string, string> } {
  const props = new Map<string, string>();
  const style = new Proxy({} as Record<string, string>, {
    set(target, prop, value) {
      target[prop as string] = value;
      return true;
    },
    get(target, prop) {
      if (prop === "setProperty") {
        return (k: string, v: string) => props.set(k, v);
      }
      return target[prop as string];
    },
  });
  const el = { style } as unknown as HTMLElement;
  return { el, props };
}

Deno.test("applyTheme", async (t) => {
  await t.step("sets CSS custom properties from default (dark) theme", () => {
    const { el, props } = mockElement();
    applyTheme(el, defaultTheme);

    assertStrictEquals(props.get("--aai-bg"), "#0f0e17");
    assertStrictEquals(props.get("--aai-surface-light"), "#2b2c3f");
    assertStrictEquals(props.get("--aai-text-muted"), "#94a1b2");
    assertStrictEquals(props.get("--aai-state-listening"), "#7f5af0");
    assertStrictEquals(props.get("--aai-state-error"), "#ff6b6b");
    // 9 base + 6 states
    assertStrictEquals(props.size, 15);
  });

  await t.step("darkTheme is same as defaultTheme", () => {
    assertStrictEquals(darkTheme, defaultTheme);
  });

  await t.step("applies light theme", () => {
    const { el, props } = mockElement();
    applyTheme(el, lightTheme);

    assertStrictEquals(props.get("--aai-bg"), "#ffffff");
    assertStrictEquals(props.get("--aai-primary"), "#2196F3");
    assertStrictEquals(props.size, 15);
  });
});

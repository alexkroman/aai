import { mount } from "./mount.ts";
import { App } from "./_components.tsx";

mount(App, {
  platformUrl: new URL(".", globalThis.location.href).href.replace(/\/$/, ""),
});

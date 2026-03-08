import { mount } from "@aai/ui/mount";
import { App } from "@aai/ui/components";

mount(App, {
  platformUrl: new URL(".", globalThis.location.href).href.replace(/\/$/, ""),
});

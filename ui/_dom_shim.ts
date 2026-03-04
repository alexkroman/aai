import { Element as DOMElement } from "@b-fuze/deno-dom";

function createStyleProxy() {
  const store = new Map<string, string>();
  return new Proxy(
    {} as Record<string, string | ((...a: string[]) => string)>,
    {
      get(_target, prop) {
        if (prop === "setProperty") {
          return (n: string, v: string) => store.set(n, v);
        }
        if (prop === "getPropertyValue") {
          return (n: string) => store.get(n) ?? "";
        }
        if (prop === "removeProperty") {
          return (n: string) => {
            store.delete(n);
            return "";
          };
        }
        if (prop === "cssText") return "";
        if (typeof prop === "string") return store.get(prop) ?? "";
        return undefined;
      },
      set(_target, prop, value) {
        if (typeof prop === "string") store.set(prop, value ?? "");
        return true;
      },
    },
  );
}

let installed = false;

export function installDomShim(): void {
  if (installed) return;
  installed = true;

  if (!Object.getOwnPropertyDescriptor(DOMElement.prototype, "style")) {
    const styleMap = new WeakMap<
      DOMElement,
      ReturnType<typeof createStyleProxy>
    >();
    Object.defineProperty(DOMElement.prototype, "style", {
      get() {
        let s = styleMap.get(this);
        if (!s) {
          s = createStyleProxy();
          styleMap.set(this, s);
        }
        return s;
      },
      configurable: true,
    });
  }

  if (!DOMElement.prototype.scrollIntoView) {
    DOMElement.prototype.scrollIntoView = function () {};
  }
}

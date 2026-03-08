import { expect } from "@std/expect";
import { handleInstall } from "./install.ts";

Deno.test("handleInstall", async (t) => {
  await t.step("returns shell script with correct content type", () => {
    const res = handleInstall();
    expect(res.headers.get("Content-Type")).toBe(
      "text/plain; charset=utf-8",
    );
  });

  await t.step("script starts with shebang", async () => {
    const res = handleInstall();
    const body = await res.text();
    expect(body.startsWith("#!/bin/sh")).toBe(true);
  });

  await t.step("script contains install logic", async () => {
    const res = handleInstall();
    const body = await res.text();
    expect(body).toContain("INSTALL_DIR");
    expect(body).toContain("curl");
    expect(body).toContain("chmod +x");
  });
});

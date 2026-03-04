import { expect } from "@std/expect";
import { createOrchestrator } from "./orchestrator.ts";
import { createTestStore } from "./_test_utils.ts";

Deno.test("createOrchestrator 404s", async (t) => {
  await t.step("returns landing page for root path", async () => {
    using store = createTestStore();
    const { app } = createOrchestrator({ store });
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("</html>");
  });

  await t.step("returns 404 for unknown agent slug", async () => {
    using store = createTestStore();
    const { app } = createOrchestrator({ store });
    const res = await app.request("/nonexistent");
    expect(res.status).toBe(404);
  });

  await t.step("returns 404 for unknown nested path", async () => {
    using store = createTestStore();
    const { app } = createOrchestrator({ store });
    const res = await app.request("/foo/bar/baz");
    expect(res.status).toBe(404);
  });

  await t.step("still serves /health", async () => {
    using store = createTestStore();
    const { app } = createOrchestrator({ store });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });
});

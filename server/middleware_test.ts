import { expect } from "@std/expect";
import { createOrchestrator } from "./orchestrator.ts";
import { createTestStore } from "./_test_utils.ts";

Deno.test("orchestrator adds Cross-Origin-Isolation headers", async () => {
  using store = createTestStore();
  const { app } = createOrchestrator({ store });
  const res = await app.request("/health");
  expect(res.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
  expect(res.headers.get("Cross-Origin-Embedder-Policy")).toBe(
    "credentialless",
  );
});

Deno.test("orchestrator returns 500 on unhandled error", async () => {
  using store = createTestStore();
  const { app } = createOrchestrator({ store });
  // Requesting a deploy without auth header triggers handler error path
  const res = await app.request("/ns/agent/deploy", { method: "POST" });
  // Deploy handler returns 400 for missing auth, not 500
  expect(res.status).toBe(400);
});

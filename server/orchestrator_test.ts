import { assertEquals, assertStringIncludes } from "@std/assert";
import { createOrchestrator } from "./orchestrator.ts";
import {
  createTestStore,
  createTestTokenSigner,
  DUMMY_INFO,
} from "./_test_utils.ts";

Deno.test("createOrchestrator", async (t) => {
  await t.step("returns landing page for root path", async () => {
    using store = createTestStore();
    const tokenSigner = await createTestTokenSigner();
    const { handler } = await createOrchestrator({ store, tokenSigner });
    const res = await handler(new Request("http://localhost/"), DUMMY_INFO);
    assertEquals(res.status, 200);
    assertStringIncludes(await res.text(), "</html>");
  });

  await t.step("returns 404 for unknown agent slug", async () => {
    using store = createTestStore();
    const tokenSigner = await createTestTokenSigner();
    const { handler } = await createOrchestrator({ store, tokenSigner });
    const res = await handler(
      new Request("http://localhost/nonexistent"),
      DUMMY_INFO,
    );
    assertEquals(res.status, 404);
  });

  await t.step("returns 404 for unknown nested path", async () => {
    using store = createTestStore();
    const tokenSigner = await createTestTokenSigner();
    const { handler } = await createOrchestrator({ store, tokenSigner });
    const res = await handler(
      new Request("http://localhost/foo/bar/baz"),
      DUMMY_INFO,
    );
    assertEquals(res.status, 404);
  });

  await t.step("still serves /health", async () => {
    using store = createTestStore();
    const tokenSigner = await createTestTokenSigner();
    const { handler } = await createOrchestrator({ store, tokenSigner });
    const res = await handler(
      new Request("http://localhost/health"),
      DUMMY_INFO,
    );
    assertEquals(res.status, 200);
  });

  await t.step("serves /metrics in Prometheus text format", async () => {
    using store = createTestStore();
    const tokenSigner = await createTestTokenSigner();
    const { handler } = await createOrchestrator({ store, tokenSigner });
    const res = await handler(
      new Request("http://localhost/metrics"),
      DUMMY_INFO,
    );
    assertEquals(res.status, 200);
    assertEquals(
      res.headers.get("Content-Type"),
      "text/plain; version=0.0.4",
    );
    const body = await res.text();
    assertStringIncludes(body, "aai_sessions_total");
    assertStringIncludes(body, "# TYPE");
  });

  await t.step(
    "serves per-agent /metrics with agent label stripped",
    async () => {
      using store = createTestStore();
      const tokenSigner = await createTestTokenSigner();
      const { handler } = await createOrchestrator({ store, tokenSigner });
      const res = await handler(
        new Request("http://localhost/test-ns/test-agent/metrics"),
        DUMMY_INFO,
      );
      assertEquals(res.status, 200);
      assertEquals(
        res.headers.get("Content-Type"),
        "text/plain; version=0.0.4",
      );
      const body = await res.text();
      assertStringIncludes(body, "aai_sessions_total");
      assertStringIncludes(body, "aai_tool_duration_seconds");
      // Global metrics should not appear
      assertEquals(body.includes("aai_llm_duration_seconds"), false);
    },
  );
});

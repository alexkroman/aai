import { expect } from "@std/expect";
import { runDeploy } from "./deploy.ts";
import type { BundleOutput } from "./_bundler.ts";

function makeBundle(slug: string): BundleOutput {
  return {
    worker: "// worker",
    client: "// client",
    manifest: JSON.stringify({ slug, env: { SLUG: slug } }),
    workerBytes: 9,
    clientBytes: 9,
  };
}

Deno.test("runDeploy", async (t) => {
  await t.step("deploys bundle to server", async () => {
    const fetched: { url: string; authHeader: string | null }[] = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "ok", slug: "agent-a" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      fetched.push({
        url,
        authHeader:
          (init?.headers as Record<string, string>)?.["Authorization"] ?? null,
      });
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }) as typeof fetch;

    try {
      await runDeploy({
        url: "http://localhost:3000",
        bundle: makeBundle("agent-a"),
        slug: "agent-a",
        dryRun: false,
        apiKey: "test-key",
      });
      expect(fetched[0].url).toBe("http://localhost:3000/deploy");
      expect(fetched[0].authHeader).toBe("Bearer test-key");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  await t.step("dry run does not call fetch", async () => {
    let fetchCalled = false;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      fetchCalled = true;
      return Promise.resolve(new Response("ok"));
    }) as typeof fetch;

    try {
      await runDeploy({
        url: "http://localhost:3000",
        bundle: makeBundle("agent-a"),
        slug: "agent-a",
        dryRun: true,
        apiKey: "test-key",
      });
      expect(fetchCalled).toBe(false);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

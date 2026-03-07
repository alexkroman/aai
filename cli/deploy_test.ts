import { expect } from "@std/expect";
import { runDeploy } from "./deploy.ts";
import type { BundleOutput } from "./_bundler.ts";

function makeBundle(): BundleOutput {
  return {
    worker: "// worker",
    client: "// client",
    manifest: JSON.stringify({ env: { ASSEMBLYAI_API_KEY: "test" } }),
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
          new Response(JSON.stringify({ status: "ok" }), {
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
      const result = await runDeploy({
        url: "http://localhost:3000",
        bundle: makeBundle(),
        namespace: "my-ns",
        slug: "agent-a",
        dryRun: false,
        apiKey: "test-key",
      });
      expect(fetched[0].url).toBe("http://localhost:3000/my-ns/agent-a/deploy");
      expect(fetched[0].authHeader).toBe("Bearer test-key");
      expect(result.namespace).toBe("my-ns");
      expect(result.slug).toBe("agent-a");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  await t.step("auto-increments namespace on 403", async () => {
    const urls: string[] = [];
    const origFetch = globalThis.fetch;
    let attempt = 0;
    globalThis.fetch = ((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "ok" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      urls.push(url);
      attempt++;
      if (attempt <= 2) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ error: 'Namespace "my-ns" is owned by another' }),
            { status: 403, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }) as typeof fetch;

    try {
      const result = await runDeploy({
        url: "http://localhost:3000",
        bundle: makeBundle(),
        namespace: "my-ns",
        slug: "agent-a",
        dryRun: false,
        apiKey: "test-key",
      });
      expect(urls[0]).toContain("/my-ns/");
      expect(urls[1]).toContain("/my-ns-1/");
      expect(urls[2]).toContain("/my-ns-2/");
      expect(result.namespace).toBe("my-ns-2");
      expect(result.slug).toBe("agent-a");
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
      const result = await runDeploy({
        url: "http://localhost:3000",
        bundle: makeBundle(),
        namespace: "my-ns",
        slug: "agent-a",
        dryRun: true,
        apiKey: "test-key",
      });
      expect(fetchCalled).toBe(false);
      expect(result.namespace).toBe("my-ns");
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

import { expect } from "@std/expect";
import { runDeploy } from "./deploy.ts";

function mockReadTextFile(path: string | URL): Promise<string> {
  const p = String(path);
  if (p.endsWith("manifest.json")) {
    return Promise.resolve(
      JSON.stringify({ slug: "agent-a", env: { SLUG: "agent-a" } }),
    );
  }
  return Promise.resolve("// js content");
}

Deno.test("runDeploy", async (t) => {
  await t.step("deploys all bundles found in bundleDir", async () => {
    const fetched: string[] = [];
    const doFetch: typeof globalThis.fetch = (input) => {
      fetched.push(String(input));
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    };

    await runDeploy(
      {
        url: "http://localhost:3000",
        bundleDir: "dist/bundle",
        slug: "agent-a",
        dryRun: false,
      },
      doFetch,
      mockReadTextFile,
    );
    expect(fetched).toEqual(["http://localhost:3000/deploy"]);
  });

  await t.step("dry run does not call fetch", async () => {
    let fetchCalled = false;
    const doFetch: typeof globalThis.fetch = () => {
      fetchCalled = true;
      return Promise.resolve(new Response("ok"));
    };

    await runDeploy(
      {
        url: "http://localhost:3000",
        bundleDir: "dist/bundle",
        slug: "agent-a",
        dryRun: true,
      },
      doFetch,
      mockReadTextFile,
    );
    expect(fetchCalled).toBe(false);
  });
});

// Copyright 2025 the AAI authors. MIT license.
import { assert, assertStrictEquals } from "@std/assert";
import { join } from "@std/path";
import { runBuild } from "./build.ts";

Deno.test(
  { name: "runBuild", sanitizeOps: false, sanitizeResources: false },
  async (t) => {
    await t.step("validates and bundles agent from agentDir", async () => {
      const agentDir = join(
        new URL("../templates/simple", import.meta.url).pathname,
      );

      const result = await runBuild({ agentDir });

      assert(result.bundle.worker.length > 0);
      assert(result.bundle.client.length > 0);
      assert(result.bundle.manifest.length > 0);

      const manifest = JSON.parse(result.bundle.manifest);
      assert(manifest.env !== undefined);
      assert(manifest.transport !== undefined);
      assertStrictEquals(result.agent.slug, "simple");
    });
  },
);

// Copyright 2025 the AAI authors. MIT license.
import * as log from "@std/log";
import { join } from "@std/path";
import { step } from "./_output.ts";
import { type AgentEntry, loadAgent } from "./_discover.ts";
import { bundleAgent, BundleError, type BundleOutput } from "./_bundler.ts";

export type { BundleOutput } from "./_bundler.ts";

/** Result of a successful agent build, containing the discovered agent metadata and bundled output. */
export type BuildResult = {
  agent: AgentEntry;
  bundle: BundleOutput;
};

/** Options for {@linkcode runBuild}. */
export type BuildOpts = {
  /** Absolute path to the directory containing `agent.ts`. */
  agentDir: string;
};

/**
 * Writes build artifacts to the `.aai/build/` directory inside the agent
 * project, similar to how Next.js writes to `.next/`.
 */
async function writeBuildOutput(
  agentDir: string,
  bundle: BundleOutput,
): Promise<void> {
  const buildDir = join(agentDir, ".aai", "build");
  await Deno.mkdir(buildDir, { recursive: true });
  await Promise.all([
    Deno.writeTextFile(join(buildDir, "worker.js"), bundle.worker),
    Deno.writeTextFile(join(buildDir, "manifest.json"), bundle.manifest),
    bundle.client
      ? Deno.writeTextFile(join(buildDir, "client.js"), bundle.client)
      : Promise.resolve(),
  ]);
}

/**
 * Discovers the agent in the given directory and bundles it into deployable
 * JavaScript artifacts (worker + client).
 *
 * @param opts Build options specifying the agent directory.
 * @returns The discovered agent metadata and bundle output.
 * @throws If no `agent.ts` is found or the esbuild bundle fails.
 */
export async function runBuild(opts: BuildOpts): Promise<BuildResult> {
  const agent = await loadAgent(opts.agentDir);
  if (!agent) {
    throw new Error("No agent found — run `aai new` first");
  }

  step("Bundle", agent.slug);
  let bundle: BundleOutput;
  try {
    bundle = await bundleAgent(agent);
  } catch (err) {
    if (err instanceof BundleError) {
      log.error(err.message);
      throw new Error("Bundle failed — fix the errors above");
    }
    throw err;
  }

  await writeBuildOutput(opts.agentDir, bundle);

  return { agent, bundle };
}

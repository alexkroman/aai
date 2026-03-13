// Copyright 2025 the AAI authors. MIT license.
import { join, resolve } from "@std/path";
import type { AgentEntry } from "./_discover.ts";

/**
 * Error thrown when bundling fails.
 *
 * @param message Human-readable error message (typically formatted build output).
 */
export class BundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleError";
  }
}

/** Output artifacts produced by {@linkcode bundleAgent}. */
export type BundleOutput = {
  /** Minified ESM JavaScript for the server-side Deno Worker. */
  worker: string;
  /** Single-file HTML page with inlined client JS and CSS. */
  html: string;
  /** JSON manifest containing env var names and transport configuration. */
  manifest: string;
  /** Size of the worker bundle in bytes. */
  workerBytes: number;
};

/** Internal helpers exposed for testing. Not part of the public API. */
export const _internals = {
  BundleError,
};

/**
 * Run `vite build` with the given build target. The vite.config.ts in the
 * agent project selects worker vs client config based on AAI_BUILD_TARGET.
 */
async function runViteBuild(
  agentDir: string,
  target: "worker" | "client",
  dev?: boolean,
): Promise<void> {
  const viteBin = join(agentDir, "node_modules", ".bin", "vite");
  const env: Record<string, string> = {
    ...Deno.env.toObject(),
    AAI_BUILD_TARGET: target,
  };
  if (dev) {
    env.AAI_DEV_ROOT = resolve(new URL("..", import.meta.url).pathname);
  }

  const cmd = new Deno.Command(viteBin, {
    args: ["build"],
    cwd: agentDir,
    stdout: "piped",
    stderr: "piped",
    env,
  });

  const { code, stdout, stderr } = await cmd.output();
  if (code !== 0) {
    throw new BundleError(
      new TextDecoder().decode(stderr) ||
        new TextDecoder().decode(stdout),
    );
  }
}

/**
 * Bundles an agent project into deployable artifacts.
 *
 * Both worker and client are built with Vite. The vite.config.ts uses
 * AAI_BUILD_TARGET to select the right configuration:
 * - Worker: `build.lib` mode → single ESM file (server-side Deno Worker)
 * - Client: vite-plugin-singlefile → single HTML with inlined JS and CSS
 *
 * @param agent The discovered agent entry containing paths and configuration.
 * @param opts Optional settings. Set `skipClient` to omit the client bundle.
 * @returns The bundled worker code, single-file HTML, manifest, and byte sizes.
 * @throws {BundleError} If Vite encounters a build error.
 */
export async function bundleAgent(
  agent: AgentEntry,
  opts?: { skipClient?: boolean; dev?: boolean },
): Promise<BundleOutput> {
  // Build worker
  await runViteBuild(agent.dir, "worker", opts?.dev);
  const worker = await Deno.readTextFile(
    join(agent.dir, ".aai", "build", "worker.js"),
  );

  // Build client
  const skipClient = opts?.skipClient || !agent.clientEntry;
  let html: string;
  if (skipClient) {
    html = await Deno.readTextFile(join(agent.dir, ".aai", "index.html"));
  } else {
    await runViteBuild(agent.dir, "client", opts?.dev);
    html = await Deno.readTextFile(
      join(agent.dir, ".aai", "build", "index.html"),
    );
  }

  const manifest = JSON.stringify(
    { transport: agent.transport },
    null,
    2,
  );

  return {
    worker,
    html,
    manifest,
    workerBytes: new TextEncoder().encode(worker).length,
  };
}

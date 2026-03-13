// Copyright 2025 the AAI authors. MIT license.
import { join, resolve } from "@std/path";
import type { AgentEntry } from "./_discover.ts";

/**
 * Error thrown when esbuild bundling fails.
 *
 * @param message Human-readable error message (typically formatted esbuild output).
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
  /** Minified ESM JavaScript for the browser client. Empty string if skipped. */
  client: string;
  /** Static HTML page. */
  html: string;
  /** JSON manifest containing env var names and transport configuration. */
  manifest: string;
  /** Size of the worker bundle in bytes. */
  workerBytes: number;
  /** Size of the client bundle in bytes. */
  clientBytes: number;
};

/** Internal helpers exposed for testing. Not part of the public API. */
export const _internals = {
  BundleError,
};

/**
 * Run the project's native esbuild binary via CLI on an entry point file.
 * esbuild is installed as a devDependency in the agent project.
 */
async function runEsbuild(
  agentDir: string,
  entryPoint: string,
  args: string[],
): Promise<string> {
  const esbuildBin = join(agentDir, "node_modules", ".bin", "esbuild");

  const cmd = new Deno.Command(esbuildBin, {
    args: [entryPoint, ...args],
    cwd: agentDir,
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await cmd.output();
  if (code !== 0) {
    throw new BundleError(new TextDecoder().decode(stderr));
  }
  return new TextDecoder().decode(stdout);
}

/**
 * Compute esbuild --alias flags for local monorepo development.
 * Maps JSR package specifiers to local source files so changes to
 * sdk/ and ui/ are reflected without publishing to JSR.
 */
function devAliasArgs(): string[] {
  const root = resolve(new URL("..", import.meta.url).pathname);
  return [
    // Map JSR npm-bridge package names to local source entry points
    `--alias:@jsr/aai__sdk=${resolve(root, "sdk/mod.ts")}`,
    `--alias:@jsr/aai__ui=${resolve(root, "ui/mod.ts")}`,
    // UI source imports @aai/sdk subpaths (workspace specifier);
    // alias each subpath individually since esbuild aliases are prefix-based.
    `--alias:@aai/sdk/protocol=${resolve(root, "sdk/protocol.ts")}`,
    `--alias:@aai/sdk=${resolve(root, "sdk/mod.ts")}`,
    // SDK source uses Deno import-map specifiers that esbuild can't resolve;
    // redirect to the JSR npm-bridge equivalents already in node_modules.
    "--alias:zod=@jsr/zod__zod",
    "--alias:json-schema=@jsr/types__json-schema",
    "--alias:@std/async=@jsr/std__async",
    "--alias:@std/log=@jsr/std__log",
  ];
}

const COMMON_ARGS = [
  "--bundle",
  "--format=esm",
  "--platform=neutral",
  "--target=es2022",
  "--tree-shaking=true",
  "--minify",
  "--legal-comments=none",
  '--define:process.env.NODE_ENV="production"',
  "--drop:debugger",
  "--log-override:commonjs-variable-in-esm=silent",
  "--main-fields=module,main",
  "--loader:.json=json",
  "--loader:.txt=text",
  "--loader:.md=text",
  "--loader:.csv=text",
  "--loader:.html=text",
];

/**
 * Bundles an agent project into deployable artifacts.
 *
 * The bundler does NOT generate any code — it bundles files that already
 * exist in the agent project:
 * - `_worker.ts` — imports agent.ts and calls initWorker()
 * - `client.tsx` — imports mount() and calls it with a component
 * - `index.html` — static HTML shell
 *
 * @param agent The discovered agent entry containing paths and configuration.
 * @param opts Optional settings. Set `skipClient` to omit the client bundle.
 * @returns The bundled worker code, client code, HTML, manifest, and byte sizes.
 * @throws {BundleError} If esbuild encounters a build error.
 */
export async function bundleAgent(
  agent: AgentEntry,
  opts?: { skipClient?: boolean; dev?: boolean },
): Promise<BundleOutput> {
  const extraArgs = opts?.dev ? devAliasArgs() : [];

  const workerEntry = join(agent.dir, "_worker.ts");
  const worker = await runEsbuild(
    agent.dir,
    workerEntry,
    [...COMMON_ARGS, ...extraArgs],
  );

  let client = "";
  const skipClient = opts?.skipClient || !agent.clientEntry;
  if (!skipClient) {
    client = await runEsbuild(agent.dir, resolve(agent.clientEntry), [
      ...COMMON_ARGS,
      ...extraArgs,
      "--jsx=automatic",
      "--jsx-import-source=preact",
      "--loader:.ts=tsx",
      "--loader:.tsx=tsx",
    ]);
  }

  const htmlPath = join(agent.dir, "index.html");
  const html = await Deno.readTextFile(htmlPath);

  const manifest = JSON.stringify(
    { transport: agent.transport },
    null,
    2,
  );

  return {
    worker,
    client,
    html,
    manifest,
    workerBytes: new TextEncoder().encode(worker).length,
    clientBytes: new TextEncoder().encode(client).length,
  };
}

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
 * sdk/ are reflected without publishing to JSR.
 */
function devAliasArgs(): string[] {
  const root = resolve(new URL("..", import.meta.url).pathname);
  return [
    // Map JSR npm-bridge package names to local source entry points
    `--alias:@jsr/aai__sdk=${resolve(root, "sdk/mod.ts")}`,
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
 * Build the client (HTML + CSS + JS) into a single HTML file using Vite
 * with vite-plugin-singlefile. All CSS and JS are inlined into the HTML.
 *
 * Vite reads `.aai/index.html` (scaffolded with the project) which
 * references client.tsx and styles.css via relative paths. The singlefile
 * plugin inlines everything into one self-contained HTML file.
 */
async function runViteBuild(
  agentDir: string,
  dev?: boolean,
): Promise<string> {
  const viteBin = join(agentDir, "node_modules", ".bin", "vite");
  const cmd = new Deno.Command(viteBin, {
    args: ["build"],
    cwd: agentDir,
    stdout: "piped",
    stderr: "piped",
    ...(dev
      ? {
        env: {
          ...Deno.env.toObject(),
          AAI_DEV_ROOT: resolve(new URL("..", import.meta.url).pathname),
        },
      }
      : {}),
  });

  const { code, stdout, stderr } = await cmd.output();
  if (code !== 0) {
    throw new BundleError(
      new TextDecoder().decode(stderr) ||
        new TextDecoder().decode(stdout),
    );
  }

  return await Deno.readTextFile(join(agentDir, ".aai", "build", "index.html"));
}

/**
 * Bundles an agent project into deployable artifacts.
 *
 * - Worker: bundled with esbuild (server-side Deno Worker code)
 * - Client: bundled with Vite + vite-plugin-singlefile into a single HTML
 *   file containing inlined JS and CSS
 *
 * @param agent The discovered agent entry containing paths and configuration.
 * @param opts Optional settings. Set `skipClient` to omit the client bundle.
 * @returns The bundled worker code, single-file HTML, manifest, and byte sizes.
 * @throws {BundleError} If esbuild or Vite encounters a build error.
 */
export async function bundleAgent(
  agent: AgentEntry,
  opts?: { skipClient?: boolean; dev?: boolean },
): Promise<BundleOutput> {
  const extraArgs = opts?.dev ? devAliasArgs() : [];

  const workerEntry = join(agent.dir, ".aai", "_worker.ts");
  const worker = await runEsbuild(
    agent.dir,
    workerEntry,
    [...COMMON_ARGS, ...extraArgs],
  );

  // Build client+CSS+HTML as a single file with Vite
  const skipClient = opts?.skipClient || !agent.clientEntry;
  let html: string;
  if (skipClient) {
    html = await Deno.readTextFile(join(agent.dir, ".aai", "index.html"));
  } else {
    html = await runViteBuild(agent.dir, opts?.dev);
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

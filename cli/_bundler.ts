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
  /** Static HTML page rendered from layout.tsx at build time. */
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
 * Run the project's native esbuild binary via CLI.
 * esbuild is installed as a devDependency in the agent project.
 */
async function runEsbuild(
  agentDir: string,
  args: string[],
  stdin: string,
): Promise<string> {
  const esbuildBin = join(agentDir, "node_modules", ".bin", "esbuild");

  const cmd = new Deno.Command(esbuildBin, {
    args,
    cwd: agentDir,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });

  const process = cmd.spawn();
  const writer = process.stdin.getWriter();
  await writer.write(new TextEncoder().encode(stdin));
  await writer.close();

  const { code, stdout, stderr } = await process.output();
  if (code !== 0) {
    throw new BundleError(new TextDecoder().decode(stderr));
  }
  return new TextDecoder().decode(stdout);
}

/**
 * Execute a bundled JS module via Node and capture its stdout.
 * Used to render layout.tsx to HTML at build time.
 */
async function renderBundle(
  agentDir: string,
  bundle: string,
): Promise<string> {
  const tmp = await Deno.makeTempFile({ suffix: ".mjs" });
  try {
    await Deno.writeTextFile(tmp, bundle);
    const cmd = new Deno.Command("node", {
      args: [tmp],
      cwd: agentDir,
      stdout: "piped",
      stderr: "piped",
    });
    const { code, stdout, stderr } = await cmd.output();
    if (code !== 0) {
      throw new BundleError(
        "Layout render failed:\n" + new TextDecoder().decode(stderr),
      );
    }
    return new TextDecoder().decode(stdout).trimEnd();
  } finally {
    await Deno.remove(tmp).catch(() => {});
  }
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
 * Bundles an agent's `agent.ts` and optional `client.ts` into
 * minified ESM JavaScript using the project's native esbuild binary.
 *
 * @param agent The discovered agent entry containing paths and configuration.
 * @param opts Optional settings. Set `skipClient` to omit the client bundle.
 * @returns The bundled worker code, client code, manifest, and byte sizes.
 * @throws {BundleError} If esbuild encounters a build error.
 */
export async function bundleAgent(
  agent: AgentEntry,
  opts?: { skipClient?: boolean },
): Promise<BundleOutput> {
  const agentAbsolute = resolve(agent.entryPoint);

  // Env values are NOT embedded in the bundle — they're injected at runtime
  // by the server via applyEnv() on each RPC call, like Vercel injects env vars.
  const shimPath = resolve(
    new URL("../sdk/_worker_shim.ts", import.meta.url).pathname,
  );
  const workerStdin = `import agent from "${agentAbsolute}";\n` +
    `import { initWorker } from "${shimPath}";\n` +
    `initWorker(agent);\n`;

  const worker = await runEsbuild(agent.dir, COMMON_ARGS, workerStdin);

  let client = "";
  const skipClient = opts?.skipClient || !agent.clientEntry;
  if (!skipClient) {
    const clientStdin = `import { mount } from "@jsr/aai__ui";\n` +
      `import App from "${resolve(agent.clientEntry)}";\n` +
      `mount(App);\n`;

    client = await runEsbuild(agent.dir, [
      ...COMMON_ARGS,
      "--jsx=automatic",
      "--jsx-import-source=preact",
      "--loader:.ts=tsx",
      "--loader:.tsx=tsx",
    ], clientStdin);
  }

  // Render layout.tsx to static HTML at build time
  const layoutAbsolute = resolve(join(agent.dir, "layout.tsx"));
  const layoutStdin =
    `import { renderToString } from "preact-render-to-string";\n` +
    `import { h } from "preact";\n` +
    `import Layout from "${layoutAbsolute}";\n` +
    `console.log("<!DOCTYPE html>" + renderToString(h(Layout, {})));\n`;

  const layoutJs = await runEsbuild(agent.dir, [
    ...COMMON_ARGS,
    "--jsx=automatic",
    "--jsx-import-source=preact",
    "--loader:.ts=tsx",
    "--loader:.tsx=tsx",
  ], layoutStdin);

  const html = await renderBundle(agent.dir, layoutJs);

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

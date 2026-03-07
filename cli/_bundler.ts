import {
  build,
  type BuildOptions,
  formatMessages,
  initialize,
  transform,
} from "esbuild";
import type { InitializeOptions } from "esbuild-wasm-types";
import { denoPlugin } from "@deno/esbuild-plugin";
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import type { AgentEntry } from "./_discover.ts";

export class BundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleError";
  }
}

async function buildWithCleanErrors(
  options: BuildOptions,
): ReturnType<typeof build> {
  try {
    return await build(options);
  } catch (err: unknown) {
    if (
      err && typeof err === "object" && "errors" in err &&
      Array.isArray((err as { errors: unknown[] }).errors)
    ) {
      const errors = (err as { errors: unknown[] }).errors as Parameters<
        typeof formatMessages
      >[0];
      const formatted = await formatMessages(errors, {
        kind: "error",
        color: true,
      });
      throw new BundleError(formatted.join("\n"));
    }
    throw err;
  }
}

let esbuildReady: Promise<void> | null = null;

/** Ensure esbuild-wasm is initialized (needed inside deno compile). */
function ensureInit() {
  if (!esbuildReady) {
    esbuildReady = (async () => {
      const esbuildDir = dirname(fromFileUrl(import.meta.resolve("esbuild")));
      const wasmPath = join(esbuildDir, "..", "esbuild.wasm");
      const wasmBytes = await Deno.readFile(wasmPath);
      const wasmModule = new WebAssembly.Module(wasmBytes);
      await initialize(
        { wasmModule, worker: false } as unknown as InitializeOptions,
      );
    })().catch(() => {
      esbuildReady = null;
    });
  }
  return esbuildReady;
}

/** Strip TypeScript type annotations, returning plain JavaScript. */
export async function stripTypes(source: string): Promise<string> {
  await ensureInit();
  const result = await transform(source, { loader: "ts" });
  return result.code;
}

/** Root of the aai framework (parent of cli/). */
const AAI_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const baseConfigPath = resolve(AAI_ROOT, "deno.json");

const BASE: BuildOptions = {
  bundle: true,
  write: false,
  format: "esm",
  platform: "neutral",
  mainFields: ["module", "main"],
  target: "es2022",
  treeShaking: true,
  minify: true,
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
  drop: ["debugger"],
  logOverride: { "commonjs-variable-in-esm": "silent" },
};

function jsBytes(metafile: { outputs: Record<string, { bytes: number }> }) {
  for (const [file, info] of Object.entries(metafile.outputs)) {
    if (file.endsWith(".js")) return info.bytes;
  }
  return 0;
}

function getOutputText(
  result: { outputFiles?: { path: string; text: string }[] },
): string {
  return result.outputFiles?.[0]?.text ?? "";
}

export interface BundleOutput {
  worker: string;
  client: string;
  manifest: string;
  workerBytes: number;
  clientBytes: number;
}

export async function bundleAgent(
  agent: AgentEntry,
  opts?: { skipClient?: boolean },
): Promise<BundleOutput> {
  await ensureInit();

  const agentAbsolute = resolve(agent.entryPoint);
  const workerEntryAbsolute = resolve(AAI_ROOT, "core/_worker_entry.ts");

  // denoPlugin resolves framework deps (JSR/npm via deno.json).
  // nodePaths lets esbuild natively resolve agent deps from their node_modules.
  const plugins = [denoPlugin({ configPath: baseConfigPath })];
  const nodePaths = [join(agent.dir, "node_modules")];

  const workerResult = await buildWithCleanErrors({
    ...BASE,
    plugins,
    nodePaths,
    stdin: {
      contents: `import agent from "${agentAbsolute}";\n` +
        `import { startWorker } from "${workerEntryAbsolute}";\n` +
        `const env: Record<string, string> = ${JSON.stringify(agent.env)};\n` +
        `startWorker(agent, env);\n`,
      loader: "ts",
      resolveDir: AAI_ROOT,
    },
    outfile: "worker.js",
    metafile: true,
    loader: {
      ".json": "json",
      ".txt": "text",
      ".md": "text",
      ".csv": "text",
      ".html": "text",
    },
  });

  let client = "";
  let clientBytes = 0;
  if (!opts?.skipClient) {
    let clientEntry = `import "${resolve(agent.clientEntry)}";\n`;
    if (agent.clientEntry.startsWith(agent.dir)) {
      const clientSrc = await Deno.readTextFile(agent.clientEntry);
      const hasMount = /\bmount\s*\(/.test(clientSrc);
      const hasDefaultExport = /export\s+default\b/.test(clientSrc);
      if (!hasMount && hasDefaultExport) {
        clientEntry = `import { mount } from "@aai/ui";\n` +
          `import App from "${resolve(agent.clientEntry)}";\n` +
          `mount(App, { platformUrl: new URL(".", globalThis.location.href).href.replace(/\\/$/, "") });\n`;
      }
    }

    const clientResult = await buildWithCleanErrors({
      ...BASE,
      plugins,
      nodePaths,
      stdin: {
        contents: clientEntry,
        loader: "tsx",
        resolveDir: AAI_ROOT,
      },
      outfile: "client.js",
      jsx: "automatic",
      jsxImportSource: "preact",
      metafile: true,
    });
    client = getOutputText(clientResult);
    clientBytes = jsBytes(clientResult.metafile!);
  }

  const manifest = JSON.stringify(
    {
      slug: agent.slug,
      env: agent.env,
      transport: agent.transport,
      config: agent.config,
      toolSchemas: agent.toolSchemas,
    },
    null,
    2,
  );

  return {
    worker: getOutputText(workerResult),
    client,
    manifest,
    workerBytes: jsBytes(workerResult.metafile!),
    clientBytes,
  };
}

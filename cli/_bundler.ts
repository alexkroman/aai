import {
  build,
  type BuildOptions,
  formatMessages,
  initialize,
  type Plugin,
  transform,
} from "esbuild";
import type { InitializeOptions } from "esbuild-wasm-types";
import { denoPlugin } from "@deno/esbuild-plugin";
import { exists } from "@std/fs/exists";
import { dirname, fromFileUrl, join, resolve, toFileUrl } from "@std/path";
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

let cacheWarmed = false;

/** Pre-populate Deno's npm cache so esbuild resolution doesn't trigger noisy
 *  download logs mid-build. Safe to call multiple times -- only runs once. */
export async function warmNpmCache(): Promise<void> {
  if (cacheWarmed) return;
  cacheWarmed = true;
  await ensureInit();
  await Promise.allSettled([
    import("preact"),
    import("preact/hooks"),
    import("preact/compat"),
    import("@preact/signals"),
    import("goober"),
  ]);
}

/** Strip TypeScript type annotations, returning plain JavaScript.
 *  Requires esbuild to be initialized first (call warmNpmCache). */
export async function stripTypes(source: string): Promise<string> {
  const result = await transform(source, { loader: "ts" });
  return result.code;
}

/** Root of the aai framework (parent of cli/). */
const AAI_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const baseConfigPath = resolve(AAI_ROOT, "deno.json");

/**
 * Read the agent's deno.json imports and return an esbuild plugin that rewrites
 * bare specifiers to their mapped npm:/jsr: URLs so denoPlugin can resolve them.
 */
async function agentImportsPlugin(agentDir: string): Promise<Plugin | null> {
  const imports: Record<string, string> = {};
  try {
    const raw = JSON.parse(
      await Deno.readTextFile(join(agentDir, "deno.json")),
    );
    Object.assign(imports, raw.imports ?? {});
  } catch { /* no agent deno.json */ }

  if (Object.keys(imports).length === 0) return null;

  return {
    name: "agent-imports",
    setup(b) {
      // Rewrite bare specifiers to their mapped npm:/jsr: URLs, then
      // re-resolve so denoPlugin handles them.
      b.onResolve({ filter: /^[^./]/ }, async (args) => {
        const mapped = imports[args.path];
        if (!mapped) return undefined;
        const result = await b.resolve(mapped, {
          resolveDir: args.resolveDir,
          kind: args.kind,
        });
        return result;
      });
    },
  };
}

/** Loads .worklet.js files as text strings so they can be passed to
 *  AudioContext.audioWorklet.addModule() at runtime. Must be listed
 *  before denoPlugin so it intercepts the resolve first. */
const workletTextPlugin: Plugin = {
  name: "worklet-text",
  setup(build) {
    build.onResolve({ filter: /\.worklet\.js$/ }, (args) => ({
      path: resolve(args.resolveDir, args.path),
      namespace: "worklet-text",
    }));
    build.onLoad(
      { filter: /.*/, namespace: "worklet-text" },
      async (args) => ({
        contents: await Deno.readTextFile(args.path),
        loader: "text" as const,
      }),
    );
  },
};

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

/** Write esbuild output files to disk (browser ESM build doesn't support write:true). */
async function writeOutputFiles(
  result: { outputFiles?: { path: string; contents: Uint8Array }[] },
): Promise<void> {
  if (!result.outputFiles) return;
  for (const file of result.outputFiles) {
    await Deno.writeFile(file.path, file.contents);
  }
}

/** Imports that the workspace already resolves — not truly "external". */
const WORKSPACE_IMPORTS = new Set(["@aai/sdk", "@aai/ui", "zod"]);

async function hasExternalImports(dir: string): Promise<boolean> {
  const denoJsonPath = join(dir, "deno.json");
  if (!await exists(denoJsonPath)) return false;
  try {
    const raw = JSON.parse(await Deno.readTextFile(denoJsonPath));
    const imports = raw.imports ?? {};
    return Object.keys(imports).some((k) => !WORKSPACE_IMPORTS.has(k));
  } catch {
    return false;
  }
}

async function precomputeSchemas(agent: AgentEntry) {
  if (await hasExternalImports(agent.dir)) return null;

  const { agentToolsToSchemas } = await import("../sdk/types.ts");

  const source = await Deno.readTextFile(resolve(agent.entryPoint));
  let js = await stripTypes(source);
  // Rewrite @aai/sdk imports to absolute paths so the tmp file resolves
  // correctly even when the agent dir is outside the workspace.
  const sdkPath = toFileUrl(resolve(AAI_ROOT, "sdk/mod.ts")).href;
  js = js.replace(/from\s*["']@aai\/sdk["']/g, `from "${sdkPath}"`);
  const tmpPath = join(
    dirname(resolve(agent.entryPoint)),
    `.aai-schemas-${Date.now()}.js`,
  );
  try {
    await Deno.writeTextFile(tmpPath, js);
    const mod = await import(toFileUrl(tmpPath).href);
    return agentToolsToSchemas(mod.default.tools);
  } finally {
    await Deno.remove(tmpPath).catch(() => {});
  }
}

function jsBytes(metafile: { outputs: Record<string, { bytes: number }> }) {
  for (const [file, info] of Object.entries(metafile.outputs)) {
    if (file.endsWith(".js")) return info.bytes;
  }
  return 0;
}

export interface BundleResult {
  workerBytes: number;
  clientBytes: number;
}

export async function bundleAgent(
  agent: AgentEntry,
  outDir: string,
  opts?: { skipClient?: boolean },
): Promise<BundleResult> {
  await ensureInit();
  await Deno.mkdir(outDir, { recursive: true });

  const schemas = await precomputeSchemas(agent);
  const agentPlugin = await agentImportsPlugin(agent.dir);

  const agentAbsolute = resolve(agent.entryPoint);
  const workerEntryAbsolute = resolve(AAI_ROOT, "core/_worker_entry.ts");

  const plugins = [
    ...(agentPlugin ? [agentPlugin] : []),
    denoPlugin({ configPath: baseConfigPath }),
  ];

  const workerResult = await buildWithCleanErrors({
    ...BASE,
    plugins,
    stdin: {
      contents: `import agent from "${agentAbsolute}";\n` +
        `import { startWorker } from "${workerEntryAbsolute}";\n` +
        `const env: Record<string, string> = ${JSON.stringify(agent.env)};\n` +
        `const schemas = ${JSON.stringify(schemas)};\n` +
        `startWorker(agent, env, schemas);\n`,
      loader: "ts",
      resolveDir: AAI_ROOT,
    },
    outfile: `${outDir}/worker.js`,
    metafile: true,
    loader: {
      ".json": "json",
      ".txt": "text",
      ".md": "text",
      ".csv": "text",
      ".html": "text",
    },
  });
  await writeOutputFiles(workerResult);

  let clientBytes = 0;
  if (!opts?.skipClient) {
    // If the user's custom client.tsx exports a default component but doesn't
    // call mount(), generate a wrapper entry that auto-mounts it for them.
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
      plugins: [workletTextPlugin, denoPlugin({ configPath: baseConfigPath })],
      stdin: {
        contents: clientEntry,
        loader: "tsx",
        resolveDir: AAI_ROOT,
      },
      outfile: `${outDir}/client.js`,
      jsx: "automatic",
      jsxImportSource: "preact",
      metafile: true,
    });
    await writeOutputFiles(clientResult);
    clientBytes = jsBytes(clientResult.metafile!);
  }

  await Deno.writeTextFile(
    `${outDir}/manifest.json`,
    JSON.stringify(
      { slug: agent.slug, env: agent.env, transport: agent.transport },
      null,
      2,
    ) + "\n",
  );

  return {
    workerBytes: jsBytes(workerResult.metafile!),
    clientBytes,
  };
}

import { parseArgs } from "@std/cli/parse-args";
import { debounce } from "@std/async/debounce";
import { exists } from "@std/fs/exists";
import { dirname, fromFileUrl, join } from "@std/path";
import { bold, cyan, dim, green } from "@std/fmt/colors";
import { error, step, stepInfo } from "./_output.ts";
import { runBuild } from "./build.ts";
import type { ValidationResult } from "./_validate.ts";
import type { AgentEntry } from "./_discover.ts";
import { createOrchestrator } from "../server/orchestrator.ts";
import {
  type BundleStore,
  createBundleStore,
  createMemoryS3Client,
} from "../server/bundle_store_tigris.ts";

export async function runDevCommand(args: string[]): Promise<number> {
  const flags = parseArgs(args, {
    string: ["port"],
    alias: { h: "help", p: "port" },
    boolean: ["help"],
  });

  if (flags.help) {
    console.log(
      `${green(bold("aai dev"))} — Run local dev server with file watching

${bold("USAGE:")}
  ${cyan("aai dev")}

${bold("OPTIONS:")}
  ${cyan("-p, --port")} ${
        dim("<number>")
      }   Port for local server (default: 3100)
  ${cyan("-h, --help")}             Show this help message
`,
    );
    return 0;
  }

  const cwd = Deno.env.get("INIT_CWD") || Deno.cwd();
  const port = parseInt(flags.port ?? "3100");

  const { getApiKeys } = await import("./_discover.ts");
  await getApiKeys();

  // Write CLAUDE.md if missing
  const claudePath = join(cwd, "CLAUDE.md");
  if (!await exists(claudePath)) {
    const cliDir = dirname(fromFileUrl(import.meta.url));
    const srcClaude = join(cliDir, "claude.md");
    await Deno.copyFile(srcClaude, claudePath);
    step(
      "Wrote",
      "CLAUDE.md — read this file for the aai agent API reference",
    );
  }

  // Start embedded server with in-memory store
  const s3 = createMemoryS3Client();
  const store = createBundleStore(s3, "local");
  const { app } = createOrchestrator({ store });

  step("Server", `http://localhost:${port}`);
  const server = Deno.serve(
    { port, hostname: "0.0.0.0", onListen: () => {} },
    app.fetch,
  );

  const serverUrl = `http://localhost:${port}`;
  const tmpDir = await Deno.makeTempDir({ prefix: "aai-dev-" });

  // Initial build and deploy
  let result;
  try {
    result = await runBuild({ agentDir: cwd, outDir: tmpDir });
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    server.shutdown();
    return 1;
  }

  await deployToStore(store, result.agent, result.outDir);
  step("Ready", result.agent.slug);
  printSummary(result.agent, result.validation, serverUrl);
  stepInfo("Watch", "for changes...");

  // Watch for file changes -> rebuild and redeploy
  const ac = new AbortController();
  const watcher = Deno.watchFs([cwd], { recursive: true });

  const WATCHED_EXTENSIONS = [
    ".ts",
    ".tsx",
    ".json",
    ".md",
    ".csv",
    ".txt",
    ".html",
  ];

  let building = false;
  let pendingRebuild = false;

  const rebuild = debounce(async () => {
    if (building) {
      pendingRebuild = true;
      return;
    }
    building = true;
    try {
      const freshResult = await runBuild({ agentDir: cwd, outDir: tmpDir });
      await deployToStore(store, freshResult.agent, freshResult.outDir);
      step("Ready", freshResult.agent.slug);
      printSummary(freshResult.agent, freshResult.validation, serverUrl);
    } catch (err: unknown) {
      error(err instanceof Error ? err.message : String(err));
    } finally {
      building = false;
      if (pendingRebuild) {
        pendingRebuild = false;
        rebuild();
      }
    }
  }, 300);

  const cleanup = () => {
    ac.abort();
    watcher.close();
    Deno.removeSync(tmpDir, { recursive: true });
    server.shutdown();
  };

  Deno.addSignalListener("SIGINT", cleanup);
  Deno.addSignalListener("SIGTERM", cleanup);

  for await (const event of watcher) {
    if (ac.signal.aborted) break;
    const hasRelevantChange = event.paths.some((p) =>
      WATCHED_EXTENSIONS.some((ext) => p.endsWith(ext))
    );
    if (!hasRelevantChange) continue;
    if (event.paths.every((p) => p.includes("_test.ts"))) continue;
    rebuild();
  }

  return 0;
}

async function deployToStore(
  store: BundleStore,
  agent: AgentEntry,
  outDir: string,
): Promise<void> {
  const worker = await Deno.readTextFile(`${outDir}/worker.js`);
  const client = await Deno.readTextFile(`${outDir}/client.js`);
  await store.putAgent({
    slug: agent.slug,
    env: agent.env,
    transport: agent.transport,
    worker,
    client,
  });
}

function printSummary(
  agent: AgentEntry,
  validation: ValidationResult,
  serverUrl: string,
): void {
  const tools = [
    ...(validation.builtinTools ?? []),
    ...(validation.tools ?? []),
  ];

  if (agent.transport.includes("websocket")) {
    stepInfo("App", `${serverUrl}/${agent.slug}/`);
  }
  if (agent.transport.includes("twilio")) {
    stepInfo("Twilio", `${serverUrl}/twilio/${agent.slug}/voice`);
  }

  stepInfo("Agent", validation.name ?? agent.slug);
  if (validation.voice) {
    stepInfo("Voice", validation.voice);
  }
  if (tools.length > 0) {
    stepInfo("Tools", tools.join(", "));
  }
}

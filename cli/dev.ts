import { debounce } from "@std/async/debounce";
import { log } from "./_output.ts";
import { type AgentEntry, loadAgent } from "./_discover.ts";
import { bundleAgent } from "./_bundler.ts";
import { validateAgent, type ValidationResult } from "./_validate.ts";

export interface DevOpts {
  agentDir: string;
  serverUrl: string;
  watch?: boolean;
  openBrowser?: boolean;
}

async function deploy(
  serverUrl: string,
  bundleDir: string,
  slug: string,
  apiKey: string,
): Promise<void> {
  const dir = `${bundleDir}/${slug}`;
  const manifest = JSON.parse(await Deno.readTextFile(`${dir}/manifest.json`));
  const worker = await Deno.readTextFile(`${dir}/worker.js`);
  const client = await Deno.readTextFile(`${dir}/client.js`);

  let resp: Response;
  try {
    resp = await fetch(`${serverUrl}/deploy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        slug: manifest.slug,
        env: manifest.env,
        worker,
        client,
        transport: manifest.transport,
      }),
    });
  } catch (err) {
    throw new Error(
      `Deploy request failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Deploy failed (${resp.status}): ${text}`);
  }
}

async function healthCheck(serverUrl: string, slug: string): Promise<boolean> {
  for (let i = 0; i < 6; i++) {
    try {
      const resp = await fetch(`${serverUrl}/${slug}/health`);
      if (resp.ok) {
        const data = await resp.json();
        if (data.status === "ok") return true;
      }
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 600));
  }
  return false;
}

function printSummary(
  agent: AgentEntry,
  validation: ValidationResult,
): void {
  // Env vars loaded
  const envKeys = Object.keys(agent.env);
  if (envKeys.length > 0) {
    log.stepInfo("Secrets", envKeys.join(", "));
  }

  // Tools registered
  const allTools = [
    ...(validation.builtinTools ?? []),
    ...(validation.tools ?? []),
  ];
  if (allTools.length > 0) {
    log.stepInfo("Tools", allTools.join(", "));
  }
}

function printUrls(agent: AgentEntry, serverUrl: string): void {
  if (agent.transport.includes("websocket")) {
    log.stepInfo("Listen", `${serverUrl}/${agent.slug}/`);
    const wsScheme = serverUrl.startsWith("https") ? "wss" : "ws";
    const wsBase = serverUrl.replace(/^https?/, wsScheme);
    log.info(`ws  ${wsBase}/${agent.slug}/websocket`);
  }
  if (agent.transport.includes("twilio")) {
    log.stepInfo("Twilio", `${serverUrl}/twilio/${agent.slug}/voice`);
  }
}

export async function runDev(opts: DevOpts): Promise<void> {
  const agent = await loadAgent(opts.agentDir);
  if (!agent) {
    throw new Error(
      `no agent found in ${opts.agentDir} — needs agent.ts + agent.json`,
    );
  }

  const apiKey = agent.env.ASSEMBLYAI_API_KEY;
  const tmpDir = await Deno.makeTempDir({ prefix: "aai-dev-" });

  // Validate agent definition
  log.step("Check", agent.slug);
  const validation = await validateAgent(agent);
  if (validation.errors.length > 0) {
    for (const e of validation.errors) {
      log.error(`${e.field}: ${e.message}`);
    }
    throw new Error("agent validation failed — fix the errors above");
  }

  printSummary(agent, validation);

  // Build + deploy
  log.step("Bundle", agent.slug);
  await bundleAgent(agent, `${tmpDir}/${agent.slug}`);
  log.step("Deploy", `${agent.slug} → ${opts.serverUrl}`);
  await deploy(opts.serverUrl, tmpDir, agent.slug, apiKey);

  if (await healthCheck(opts.serverUrl, agent.slug)) {
    log.step("Ready", agent.slug);
  } else {
    log.error(
      `${agent.slug} deployed but failed health check after 3s — the agent may have a runtime error`,
    );
  }

  printUrls(agent, opts.serverUrl);

  // Open in browser (only for newly created agents)
  const agentUrl = `${opts.serverUrl}/${agent.slug}/`;
  if (opts.openBrowser) {
    const openCmd = Deno.build.os === "darwin"
      ? "open"
      : Deno.build.os === "windows"
      ? "start"
      : "xdg-open";
    new Deno.Command(openCmd, { args: [agentUrl] }).spawn();
  }

  if (!opts.watch) {
    console.log();
    console.log(
      `  Use ${
        log.cyan("claude")
      } to change your agent, or edit agent.ts directly.`,
    );
    console.log(`  Run ${log.cyan("aai --watch")} to auto-reload on changes.`);
    console.log();
    Deno.removeSync(tmpDir, { recursive: true });
    return;
  }

  // Watch for file changes → rebuild and redeploy
  log.stepInfo("Watch", "for changes...");

  const watcher = Deno.watchFs([agent.dir], { recursive: true });

  const rebuild = debounce(async () => {
    try {
      const freshAgent = await loadAgent(opts.agentDir);
      if (!freshAgent) throw new Error("agent not found after change");
      log.step("Check", freshAgent.slug);
      const watchValidation = await validateAgent(freshAgent);
      if (watchValidation.errors.length > 0) {
        for (const e of watchValidation.errors) {
          log.error(`${e.field}: ${e.message}`);
        }
        return;
      }
      printSummary(freshAgent, watchValidation);
      log.step("Bundle", freshAgent.slug);
      await bundleAgent(freshAgent, `${tmpDir}/${freshAgent.slug}`);
      log.step("Deploy", `${freshAgent.slug} → ${opts.serverUrl}`);
      await deploy(opts.serverUrl, tmpDir, freshAgent.slug, apiKey);
      if (await healthCheck(opts.serverUrl, freshAgent.slug)) {
        log.step("Ready", freshAgent.slug);
      } else {
        log.error(
          `${freshAgent.slug} deployed but failed health check after 3s — the agent may have a runtime error`,
        );
      }
    } catch (err: unknown) {
      log.error(err instanceof Error ? err.message : String(err));
    }
  }, 300);

  (async () => {
    for await (const event of watcher) {
      const hasRelevantChange = event.paths.some((p) =>
        p.endsWith(".ts") || p.endsWith(".tsx")
      );
      if (!hasRelevantChange) continue;
      if (event.paths.every((p) => p.includes("_test.ts"))) continue;
      rebuild();
    }
  })();

  const cleanup = () => {
    watcher.close();
    Deno.removeSync(tmpDir, { recursive: true });
    Deno.exit(0);
  };

  Deno.addSignalListener("SIGINT", cleanup);
  Deno.addSignalListener("SIGTERM", cleanup);

  await new Promise(() => {});
}

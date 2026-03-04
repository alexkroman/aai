import { log } from "./_output.ts";
import { loadAgent } from "./_discover.ts";
import { bundleAgent } from "./_bundler.ts";
import { deployToLocal, spawnCompiled, waitForServer } from "./_server.ts";
import { runCompile } from "./compile.ts";

export interface ProdOpts {
  port: number;
  agentDir: string;
}

export async function runProd(opts: ProdOpts): Promise<void> {
  const tmpDir = await Deno.makeTempDir({ prefix: "aai-prod-" });
  const baseUrl = `http://localhost:${opts.port}`;

  const agent = await loadAgent(opts.agentDir);
  if (!agent) {
    throw new Error(
      `no agent found in ${opts.agentDir} — needs agent.ts + agent.json`,
    );
  }

  log.step("Bundle", agent.slug);
  const slugDir = `${tmpDir}/${agent.slug}`;
  const result = await bundleAgent(agent, slugDir);
  log.size("worker.js", result.workerBytes);
  log.size("client.js", result.clientBytes);

  const binaryPath = await runCompile({ outDir: tmpDir });

  const orchestrator = spawnCompiled(binaryPath, opts.port);
  await waitForServer(baseUrl);
  await deployToLocal(baseUrl, slugDir, agent.slug, agent.env, agent.transport);

  log.stepInfo("Listen", `http://localhost:${opts.port}/`);
  console.log();

  const cleanup = () => {
    orchestrator.kill();
    Deno.removeSync(tmpDir, { recursive: true });
    Deno.exit(0);
  };

  Deno.addSignalListener("SIGINT", cleanup);
  Deno.addSignalListener("SIGTERM", cleanup);

  await orchestrator.status;
}

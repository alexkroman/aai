import { log } from "./_output.ts";
import { type AgentEntry, loadAgent } from "./_discover.ts";
import { bundleAgent } from "./_bundler.ts";

export interface BuildOpts {
  outDir: string;
  agentDir: string;
}

export async function runBuild(
  opts: BuildOpts,
  load: (dir: string) => Promise<AgentEntry | null> = loadAgent,
  bundle = bundleAgent,
): Promise<void> {
  const agent = await load(opts.agentDir);
  if (!agent) {
    throw new Error(
      `no agent found in ${opts.agentDir} — needs agent.ts + agent.json`,
    );
  }

  log.step("Bundle", agent.slug);

  const t0 = performance.now();
  const outDir = `${opts.outDir}/${agent.slug}`;
  const result = await bundle(agent, outDir);
  log.size("worker.js", result.workerBytes);
  log.size("client.js", result.clientBytes);
  log.timing("done", performance.now() - t0);

  console.log();
  log.step("Done", `bundle ready in ${opts.outDir}/`);
}

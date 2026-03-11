import { brightBlue, brightMagenta, dim, red } from "@std/fmt/colors";
import { detail, error, step } from "./_output.ts";
import { type AgentEntry, loadAgent } from "./_discover.ts";
import { bundleAgent, type BundleOutput } from "./_bundler.ts";
import { validateAgent, type ValidationResult } from "./_validate.ts";

export type { BundleOutput } from "./_bundler.ts";

export type BuildResult = {
  agent: AgentEntry;
  validation: ValidationResult;
  bundle: BundleOutput;
};

export type BuildOpts = {
  agentDir: string;
};

export async function runBuild(opts: BuildOpts): Promise<BuildResult> {
  const agent = await loadAgent(opts.agentDir);
  if (!agent) {
    throw new Error("no agent found — run `aai new` first");
  }

  step("Check", agent.slug);
  const validation = await validateAgent(agent);
  if (validation.errors.length > 0) {
    for (const e of validation.errors) {
      error(`${e.field}: ${e.message}`);
    }
    throw new Error("agent validation failed — fix the errors above");
  }

  if (validation.toolTests && validation.toolTests.length > 0) {
    step("Tools", "testing custom tools...");
    for (const t of validation.toolTests) {
      if (t.ok) {
        const preview = t.result !== undefined
          ? dim(" → " + JSON.stringify(t.result).slice(0, 80))
          : "";
        detail(`${brightMagenta("✓")} ${brightBlue(t.name)}${preview}`);
      } else {
        detail(
          `${red("✗")} ${brightBlue(t.name)} ${
            red(t.error ?? "unknown error")
          }`,
        );
      }
    }
  }

  step("Bundle", agent.slug);
  let bundle: BundleOutput;
  try {
    bundle = await bundleAgent(agent);
  } catch (err) {
    if (err instanceof Error && err.name === "BundleError") {
      console.error(err.message);
      throw new Error("bundle failed — fix the errors above");
    }
    throw err;
  }

  return { agent, validation, bundle };
}

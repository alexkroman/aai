// Copyright 2025 the AAI authors. MIT license.
import { parseArgs } from "@std/cli/parse-args";
import * as log from "@std/log";
import { step, stepInfo } from "./_output.ts";
import { runBuild } from "./build.ts";
import { runDeploy } from "./_deploy.ts";
import {
  DEFAULT_SERVER,
  getApiKey,
  getNamespace,
  resolveSlug,
  saveAgentLink,
  saveNamespace,
} from "./_discover.ts";
import type { SubcommandDef } from "./_help.ts";
import { subcommandHelp } from "./_help.ts";

/** CLI definition for the `aai deploy` subcommand, including name, description, and options. */
export const deployCommandDef: SubcommandDef = {
  name: "deploy",
  description: "Bundle and deploy to production",
  options: [
    { flags: "-s, --server <url>", description: "Server URL" },
    { flags: "--local [url]", description: "Use local server", hidden: true },
    {
      flags: "--dry-run",
      description: "Validate and bundle without deploying",
    },
  ],
};

/**
 * Runs the `aai deploy` subcommand. Builds the agent bundle, resolves the
 * deploy target (namespace/slug), uploads to the server, and prints endpoint URLs.
 *
 * @param args Command-line arguments passed to the `deploy` subcommand.
 * @param version Current CLI version string, used in help output.
 * @throws If the build fails, API key is missing, or deployment fails.
 */
export async function runDeployCommand(
  args: string[],
  version: string,
): Promise<void> {
  const parsed = parseArgs(args, {
    string: ["server", "local"],
    boolean: ["dry-run", "help"],
    alias: { s: "server", h: "help" },
  });

  if (parsed.help) {
    log.info(subcommandHelp(deployCommandDef, version));
    return;
  }

  const cwd = Deno.env.get("INIT_CWD") || Deno.cwd();
  const local = parsed.local;
  const serverUrl = local !== undefined
    ? (typeof local === "string" && local !== ""
      ? local
      : "http://localhost:3100")
    : (parsed.server || DEFAULT_SERVER);

  const apiKey = await getApiKey();
  const namespace = await getNamespace();
  const result = await runBuild({ agentDir: cwd });

  const { agent } = result;
  const slug = await resolveSlug(cwd, namespace, agent.slug);
  const fullPath = `${namespace}/${slug}`;

  step("Deploy", fullPath);
  const deployed = await runDeploy({
    url: serverUrl,
    bundle: result.bundle,
    namespace,
    slug,
    dryRun: parsed["dry-run"] ?? false,
    apiKey,
  });

  if (deployed.namespace !== namespace) {
    await saveNamespace(deployed.namespace);
  }

  await saveAgentLink(cwd, {
    namespace: deployed.namespace,
    slug: deployed.slug,
    apiKey,
  });

  const deployedPath = `${deployed.namespace}/${deployed.slug}`;
  if (agent.transport.includes("websocket")) {
    stepInfo("App", `${serverUrl}/${deployedPath}`);
  }
  if (agent.transport.includes("twilio")) {
    stepInfo("Twilio", `${serverUrl}/${deployedPath}/twilio/voice`);
  }

  stepInfo("Agent", deployed.slug);
}

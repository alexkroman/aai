import { parseArgs } from "@std/cli/parse-args";
import { bold, cyan, dim, green } from "@std/fmt/colors";
import { error, step, stepInfo } from "./_output.ts";
import { runBuild } from "./build.ts";
import { runDeploy } from "./deploy.ts";

export async function runDeployCommand(args: string[]): Promise<number> {
  const flags = parseArgs(args, {
    string: ["url"],
    alias: { h: "help", u: "url" },
    boolean: ["help"],
  });

  if (flags.help) {
    console.log(
      `${green(bold("aai deploy"))} — Bundle and deploy to production

${bold("USAGE:")}
  ${cyan("aai deploy")}

${bold("OPTIONS:")}
  ${cyan("-u, --url")} ${
        dim("<url>")
      }       Server URL (default: https://aai-agent.fly.dev)
  ${cyan("-h, --help")}             Show this help message
`,
    );
    return 0;
  }

  const cwd = Deno.env.get("INIT_CWD") || Deno.cwd();
  const serverUrl = flags.url || "https://aai-agent.fly.dev";

  const { getApiKey } = await import("./_discover.ts");
  await getApiKey();

  let result;
  try {
    result = await runBuild({ agentDir: cwd });
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const { agent, validation } = result;

  step("Deploy", agent.slug);
  await runDeploy({
    url: serverUrl,
    bundle: result.bundle,
    slug: agent.slug,
    dryRun: false,
    apiKey: agent.env.ASSEMBLYAI_API_KEY,
  });

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
  if (tools.length > 0) {
    stepInfo("Tools", tools.join(", "));
  }

  return 0;
}

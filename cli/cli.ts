import { bold, cyan, dim, green } from "@std/fmt/colors";
import { error } from "./_output.ts";
import { promptUpgradeIfAvailable } from "./_update.ts";

const denoConfig = await import("./deno.json", { with: { type: "json" } });
const VERSION: string = denoConfig.default.version;

function printUsage(): void {
  console.log(
    `${green(bold("aai"))} ${dim(VERSION)} — Voice agent development kit

${bold("COMMANDS:")}
  ${cyan("aai new")}            Scaffold a new agent project
  ${cyan("aai types")}          Set up TypeScript tooling for an existing agent
  ${cyan("aai build")}          Validate and bundle the agent
  ${cyan("aai dev")}            Run local dev server with file watching
  ${cyan("aai deploy")}         Bundle and deploy to production

${bold("OPTIONS:")}
  ${cyan("-h, --help")}         Show this help message
  ${cyan("-V, --version")}      Show version number

Run ${cyan("aai <command> --help")} for command-specific options.
`,
  );
}

export async function main(args: string[]): Promise<number> {
  const command = args[0];

  // Skip update check when running via `deno run` (aai-dev) — only check for compiled binary
  const isCompiled = !Deno.execPath().endsWith("deno");
  if (isCompiled) {
    await promptUpgradeIfAvailable(VERSION);
  }

  if (command === "--help" || command === "-h") {
    printUsage();
    return 0;
  }

  // No subcommand — run `aai new`
  if (!command) {
    const { runNewCommand } = await import("./cmd_new.ts");
    return await runNewCommand([]);
  }

  if (command === "--version" || command === "-V") {
    console.log(VERSION);
    return 0;
  }

  const subArgs = args.slice(1);

  switch (command) {
    case "new": {
      const { runNewCommand } = await import("./cmd_new.ts");
      return await runNewCommand(subArgs);
    }
    case "build": {
      const { runBuildCommand } = await import("./cmd_build.ts");
      return await runBuildCommand(subArgs);
    }
    case "dev": {
      const { runDevCommand } = await import("./cmd_dev.ts");
      return await runDevCommand(subArgs);
    }
    case "deploy": {
      const { runDeployCommand } = await import("./cmd_deploy.ts");
      return await runDeployCommand(subArgs);
    }
    case "types": {
      const { runTypesCommand } = await import("./cmd_types.ts");
      return await runTypesCommand(subArgs);
    }
    default: {
      error(`unknown command: ${command}`);
      printUsage();
      return 1;
    }
  }
}

if (import.meta.main) {
  try {
    const code = await main(Deno.args);
    if (code !== 0) Deno.exit(code);
  } catch (err: unknown) {
    error(err instanceof Error ? err.message : String(err));
    Deno.exit(1);
  }
}

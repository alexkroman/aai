import { parseArgs } from "@std/cli/parse-args";
import { bold, cyan, green } from "@std/fmt/colors";
import { ensureClaudeMd, ensureTypescriptSetup } from "./_discover.ts";

export async function runTypesCommand(args: string[]): Promise<number> {
  const flags = parseArgs(args, {
    alias: { h: "help" },
    boolean: ["help"],
  });

  if (flags.help) {
    console.log(
      `${
        green(bold("aai types"))
      } — Set up TypeScript tooling for an existing agent

${bold("USAGE:")}
  ${cyan("aai types")}

Generates ${cyan(".npmrc")}, ${cyan("package.json")}, ${
        cyan("tsconfig.json")
      }, and ${cyan(".gitignore")}
if they don't already exist, then runs ${cyan("npm install")} so your editor
gets autocomplete for ${cyan("@aai/sdk")} and ${cyan("@aai/ui")}.

${bold("OPTIONS:")}
  ${cyan("-h, --help")}             Show this help message
`,
    );
    return 0;
  }

  const cwd = Deno.env.get("INIT_CWD") || Deno.cwd();

  await ensureClaudeMd(cwd);
  await ensureTypescriptSetup(cwd);

  return 0;
}

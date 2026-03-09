import { parseArgs } from "@std/cli/parse-args";
import { promptSelect } from "@std/cli/unstable-prompt-select";
import { exists } from "@std/fs/exists";
import { dirname, fromFileUrl, join } from "@std/path";
import { bold, cyan, dim, green } from "@std/fmt/colors";
import { ensureClaudeMd, ensureTypescriptSetup } from "./_discover.ts";

export async function runNewCommand(
  args: string[],
): Promise<number> {
  const flags = parseArgs(args, {
    string: ["template", "name"],
    alias: { h: "help", t: "template", n: "name", f: "force" },
    boolean: ["help", "force"],
  });

  if (flags.help) {
    console.log(
      `${green(bold("aai new"))} — Scaffold a new agent project

${bold("USAGE:")}
  ${cyan("aai new")}                    Create agent in current directory
  ${cyan("aai new")} ${dim("<dir>")}              Create agent in <dir>

${bold("OPTIONS:")}
  ${cyan("-n, --name")} ${
        dim("<name>")
      }        Agent name (pre-fills name in agent.ts)
  ${cyan("-t, --template")} ${
        dim("<name>")
      }    Template to use (default: simple)
  ${cyan("-f, --force")}              Overwrite existing agent.ts
  ${cyan("-h, --help")}               Show this help message
`,
    );
    return 0;
  }

  const cwd = flags._[0]
    ? String(flags._[0])
    : (Deno.env.get("INIT_CWD") || Deno.cwd());

  if (!flags.force && await exists(join(cwd, "agent.ts"))) {
    console.log(
      `agent.ts already exists in this directory. Use ${
        cyan("--force")
      } to overwrite.`,
    );
    return 1;
  }

  const cliDir = dirname(fromFileUrl(import.meta.url));
  const templatesDir = join(cliDir, "..", "templates");
  const { listTemplates, runNew } = await import("./new.ts");
  const templates = await listTemplates(templatesDir);

  let template = flags.template;
  if (!template) {
    const selected = promptSelect("Choose a template", templates, {
      clear: true,
    });
    if (!selected) {
      // stdin is not a TTY — fall back to default
      template = "simple";
    } else {
      template = selected;
    }
  }

  await runNew({
    targetDir: cwd,
    template,
    templatesDir,
    name: flags.name,
  });

  await ensureClaudeMd(cwd);

  await ensureTypescriptSetup(cwd);

  console.log(`Run ${cyan("aai dev")} to start a local dev server.`);
  console.log(`Run ${cyan("aai deploy")} to deploy to production.\n`);

  return 0;
}

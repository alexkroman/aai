import { parseArgs } from "@std/cli/parse-args";
import { exists } from "@std/fs/exists";
import { dirname, fromFileUrl, join } from "@std/path";
import { bold, cyan, dim, green } from "@std/fmt/colors";

export async function runNewCommand(
  args: string[],
  version: string,
): Promise<number> {
  const flags = parseArgs(args, {
    string: ["template"],
    alias: { h: "help", t: "template", y: "yes" },
    boolean: ["help", "yes"],
  });

  if (flags.help) {
    console.log(
      `${green(bold("aai new"))} — Scaffold a new agent project

${bold("USAGE:")}
  ${cyan("aai new")}                    Create agent in current directory
  ${cyan("aai new")} ${dim("<dir>")}              Create agent in <dir>

${bold("OPTIONS:")}
  ${cyan("-t, --template")} ${
        dim("<name>")
      }    Template to use (default: simple)
  ${cyan("-y, --yes")}                Skip confirmation prompts
  ${cyan("-h, --help")}               Show this help message
`,
    );
    return 0;
  }

  const cwd = flags._[0]
    ? String(flags._[0])
    : (Deno.env.get("INIT_CWD") || Deno.cwd());

  if (await exists(join(cwd, "agent.ts"))) {
    console.log("agent.ts already exists in this directory.");
    return 1;
  }

  if (!flags.yes) {
    console.log(`\n${green(bold("aai"))} ${dim(version)}`);
    console.log("Voice agent development kit\n");

    const answer = prompt(`Set up a new agent in "${cwd}"? (Y/n)`);
    if (answer === null) return 0;
    if (answer !== "" && answer.toLowerCase() !== "y") return 0;
  }

  const cliDir = dirname(fromFileUrl(import.meta.url));
  const templatesDir = join(cliDir, "..", "templates");
  const { runNew } = await import("./new.ts");

  const template = flags.template || "simple";
  await runNew({
    targetDir: cwd,
    template,
    templatesDir,
  });

  const templates: string[] = [];
  for await (const entry of Deno.readDir(templatesDir)) {
    if (entry.isDirectory) templates.push(entry.name);
  }
  templates.sort();

  console.log(`\n${bold("Templates:")}`);
  for (const t of templates) {
    const marker = t === template ? green("●") : dim("○");
    console.log(`  ${marker} ${t === template ? bold(t) : t}`);
  }
  console.log(
    dim(
      `\n  Re-run with --template <name> to start from a different template\n`,
    ),
  );

  // Write CLAUDE.md if missing
  const claudePath = join(cwd, "CLAUDE.md");
  if (!await exists(claudePath)) {
    const srcClaude = join(cliDir, "claude.md");
    await Deno.copyFile(srcClaude, claudePath);
  }

  console.log(`Run ${cyan("aai dev")} to start developing.\n`);

  return 0;
}

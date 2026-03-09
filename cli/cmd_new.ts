import { parseArgs } from "@std/cli/parse-args";
import { exists } from "@std/fs/exists";
import { dirname, fromFileUrl, join } from "@std/path";
import { bold, cyan, dim, green } from "@std/fmt/colors";
import { ensureClaudeMd } from "./_discover.ts";

export async function runNewCommand(
  args: string[],
): Promise<number> {
  const flags = parseArgs(args, {
    string: ["template", "name"],
    alias: { h: "help", t: "template", n: "name" },
    boolean: ["help"],
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

  const cliDir = dirname(fromFileUrl(import.meta.url));
  const templatesDir = join(cliDir, "..", "templates");
  const { listTemplates, runNew } = await import("./new.ts");

  const template = flags.template || "simple";
  await runNew({
    targetDir: cwd,
    template,
    templatesDir,
    name: flags.name,
  });

  const templates = await listTemplates(templatesDir);

  // Detect which templates include a custom UI (client.tsx)
  const uiTemplates = new Set<string>();
  for (const t of templates) {
    try {
      await Deno.stat(join(templatesDir, t, "client.tsx"));
      uiTemplates.add(t);
    } catch { /* no client.tsx */ }
  }

  console.log(`\n${bold("Templates:")}`);
  for (const t of templates) {
    const marker = t === template ? green("●") : dim("○");
    const label = t === template ? bold(t) : t;
    const ui = uiTemplates.has(t) ? dim(" (custom UI)") : "";
    console.log(`  ${marker} ${label}${ui}`);
  }
  console.log(
    dim(
      `\n  Re-run with --template <name> to start from a different template\n`,
    ),
  );

  await ensureClaudeMd(cwd);

  console.log(`Run ${cyan("aai dev")} to start developing.\n`);

  return 0;
}

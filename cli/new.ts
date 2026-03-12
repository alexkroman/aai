// Copyright 2025 the AAI authors. MIT license.
import { parseArgs } from "@std/cli/parse-args";
import { exists } from "@std/fs/exists";
import { dirname, fromFileUrl, join } from "@std/path";
import { brightBlue } from "@std/fmt/colors";
import * as log from "@std/log";
import { ensureClaudeMd, ensureTypescriptSetup } from "./_discover.ts";
import type { SubcommandDef } from "./_help.ts";
import { subcommandHelp } from "./_help.ts";

/** CLI definition for the `aai new` subcommand, including name, description, arguments, and options. */
export const newCommandDef: SubcommandDef = {
  name: "new",
  description: "Scaffold a new agent project",
  args: [{ name: "dir", optional: true }],
  options: [
    { flags: "-n, --name <name>", description: "Agent name" },
    { flags: "-t, --template <template>", description: "Template to use" },
    { flags: "-f, --force", description: "Overwrite existing agent.ts" },
  ],
};

/**
 * Runs the `aai new` subcommand. Scaffolds a new agent project from a template,
 * copies `CLAUDE.md`, and sets up TypeScript tooling for editor support.
 *
 * @param args Command-line arguments passed to the `new` subcommand.
 * @param version Current CLI version string, used in help output.
 */
export async function runNewCommand(
  args: string[],
  version: string,
): Promise<void> {
  const parsed = parseArgs(args, {
    string: ["name", "template"],
    boolean: ["force", "help"],
    alias: { n: "name", t: "template", f: "force", h: "help" },
  });

  if (parsed.help) {
    log.info(subcommandHelp(newCommandDef, version));
    return;
  }

  const dir = parsed._[0] as string | undefined;
  const cwd = dir ?? (Deno.env.get("INIT_CWD") || Deno.cwd());

  if (!parsed.force && await exists(join(cwd, "agent.ts"))) {
    log.info(
      `agent.ts already exists in this directory. Use ${
        brightBlue("--force")
      } to overwrite.`,
    );
    Deno.exit(1);
  }

  const cliDir = dirname(fromFileUrl(import.meta.url));
  const templatesDir = join(cliDir, "..", "templates");
  const { runNew } = await import("./_new.ts");

  const template = parsed.template || "simple";

  await runNew({
    targetDir: cwd,
    template,
    templatesDir,
    ...(parsed.name ? { name: parsed.name } : {}),
  });
  await ensureClaudeMd(cwd);
  await ensureTypescriptSetup(cwd);

  log.info(`Run ${brightBlue("aai deploy")} to deploy to production.\n`);
}

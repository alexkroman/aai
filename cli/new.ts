// Copyright 2025 the AAI authors. MIT license.
import { parseArgs } from "@std/cli/parse-args";
import { promptSelect } from "@std/cli/unstable-prompt-select";
import { exists } from "@std/fs/exists";
import { basename, dirname, fromFileUrl, join, resolve } from "@std/path";
import { brightBlue } from "@std/fmt/colors";
import * as log from "@std/log";
import { ensureClaudeMd, ensureDependencies } from "./_discover.ts";
import type { SubcommandDef } from "./_help.ts";
import { subcommandHelp } from "./_help.ts";
import { listTemplates } from "./_new.ts";

/** CLI definition for the `aai new` subcommand, including name, description, arguments, and options. */
export const newCommandDef: SubcommandDef = {
  name: "new",
  description: "Scaffold a new agent project",
  args: [{ name: "dir", optional: true }],
  options: [
    { flags: "-n, --name <name>", description: "Agent name" },
    { flags: "-t, --template <template>", description: "Template to use" },
    { flags: "-f, --force", description: "Overwrite existing agent.ts" },
    { flags: "-y, --yes", description: "Accept defaults (no prompts)" },
  ],
};

/**
 * Interactively prompts for agent name if not provided.
 * Defaults to the current directory's base name.
 */
function promptName(cwd: string): string {
  const defaultName = basename(resolve(cwd));
  const answer = prompt(`What is your agent named?`, defaultName);
  return answer || defaultName;
}

/**
 * Interactively prompts for template selection using an arrow-key menu.
 * "simple" is listed first as the default.
 */
function selectTemplate(available: string[]): string {
  // Put "simple" first since it's the default
  const sorted = ["simple", ...available.filter((t) => t !== "simple")];
  const selected = promptSelect("Which template?", sorted, { clear: true });
  return selected ?? "simple";
}

/**
 * Runs the `aai new` subcommand. Scaffolds a new agent project from a template,
 * copies `CLAUDE.md`, and sets up TypeScript tooling for editor support.
 *
 * @param args Command-line arguments passed to the `new` subcommand.
 * @param version Current CLI version string, used in help output.
 * @returns The target directory where the agent was scaffolded.
 */
export async function runNewCommand(
  args: string[],
  version: string,
): Promise<string> {
  const parsed = parseArgs(args, {
    string: ["name", "template"],
    boolean: ["force", "help", "yes"],
    alias: { n: "name", t: "template", f: "force", h: "help", y: "yes" },
  });

  if (parsed.help) {
    log.info(subcommandHelp(newCommandDef, version));
    return "";
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
  const templatesDir = join(cliDir, "templates");
  const { runNew } = await import("./_new.ts");

  // Interactive prompts when flags aren't provided (skip with -y)
  const available = await listTemplates(templatesDir);
  const template = parsed.template ||
    (parsed.yes ? "simple" : selectTemplate(available));
  const name = parsed.name ||
    (parsed.yes ? basename(resolve(cwd)) : promptName(cwd));

  await runNew({
    targetDir: cwd,
    template,
    templatesDir,
    name,
  });
  await ensureClaudeMd(cwd);
  await ensureDependencies(cwd);

  return cwd;
}

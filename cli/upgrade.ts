// Copyright 2025 the AAI authors. MIT license.
import { parseArgs } from "@std/cli/parse-args";
import { step } from "./_output.ts";
import { subcommandHelp } from "./_help.ts";
import type { SubcommandDef } from "./_help.ts";
import { denoExec } from "./_discover.ts";

const upgradeDef: SubcommandDef = {
  name: "upgrade",
  description: "Update @aai packages to the latest versions",
  options: [],
};

/**
 * Runs `deno outdated --update` scoped to `@aai/*` packages, then
 * `deno install` to refresh the lockfile and node_modules.
 */
export async function runUpgradeCommand(
  args: string[],
  version: string,
): Promise<void> {
  const parsed = parseArgs(args, { boolean: ["help"], alias: { h: "help" } });
  if (parsed.help) {
    console.log(subcommandHelp(upgradeDef, version));
    return;
  }

  const cwd = Deno.env.get("INIT_CWD") || Deno.cwd();
  const deno = denoExec();

  step("Update", "@aai packages");
  const update = new Deno.Command(deno, {
    args: ["outdated", "--update", "@aai/*"],
    cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const { code } = await update.output();
  if (code !== 0) Deno.exit(code);

  step("Install", "refreshing lockfile");
  const install = new Deno.Command(deno, {
    args: ["install"],
    cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const installResult = await install.output();
  if (installResult.code !== 0) Deno.exit(installResult.code);
}

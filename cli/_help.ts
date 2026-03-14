// Copyright 2025 the AAI authors. MIT license.
import { bold, dim } from "@std/fmt/colors";
import { interactive, primary } from "./_colors.ts";

/** Definition of a CLI option flag for help text rendering. */
export interface OptionDef {
  /** Flag syntax string (e.g. `"-s, --server <url>"`). */
  flags: string;
  /** Human-readable description of the option. */
  description: string;
  /** If `true`, the option is omitted from help output. */
  hidden?: boolean;
}

/** Definition of a CLI subcommand used to generate help text. */
export interface SubcommandDef {
  /** Subcommand name (e.g. `"new"`, `"deploy"`). */
  name: string;
  /** Short description shown in help output. */
  description: string;
  /** Positional arguments accepted by the subcommand. */
  args?: { name: string; optional?: boolean }[];
  /** Option flags accepted by the subcommand. */
  options?: OptionDef[];
}

/**
 * Generates the top-level `aai --help` output with ASCII logo, available
 * commands, global options, and a getting-started example.
 *
 * @param version The current CLI version string.
 * @returns Formatted, colorized help text.
 */
export function rootHelp(version: string): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(
    `  ${primary(bold(" ▄▀█ ▄▀█ █"))}   ${dim("Voice agent development kit")}`,
  );
  lines.push(
    `  ${primary(bold(" █▀█ █▀█ █"))}   ${primary(`v${version}`)}`,
  );
  lines.push("");
  lines.push(
    `  ${bold(interactive("Usage"))}   ${primary("aai")} ${
      dim("<command> [options]")
    }`,
  );
  lines.push("");
  lines.push(`  ${bold(interactive("Commands"))}`);
  lines.push("");

  const cmds: [string, string, string][] = [
    ["new", "[dir]", "Scaffold a new agent project"],
    ["deploy", "", "Bundle and deploy to production"],
    ["env", "<cmd>", "Manage environment variables"],
  ];

  for (const [name, args, desc] of cmds) {
    const nameStr = interactive(name.padEnd(8));
    const argsStr = args ? primary(args.padEnd(6)) : "      ";
    lines.push(`    ${nameStr} ${argsStr} ${dim(desc)}`);
  }

  lines.push("");
  lines.push(`  ${bold(interactive("Options"))}`);
  lines.push("");
  lines.push(
    `    ${interactive("-h")}${dim(",")} ${interactive("--help")}      ${
      dim("Show this help")
    }`,
  );
  lines.push(
    `    ${interactive("-V")}${dim(",")} ${interactive("--version")}   ${
      dim("Show the version number")
    }`,
  );
  lines.push("");
  lines.push(`  ${bold(interactive("Getting started"))}`);
  lines.push("");
  lines.push(
    `    ${dim("$")} ${primary("aai new")} ${interactive("my-agent")}    ${
      dim("Create a new agent")
    }`,
  );
  lines.push(`    ${dim("$")} ${primary("cd my-agent")}`);
  lines.push(
    `    ${dim("$")} ${primary("aai deploy")}          ${
      dim("Deploy to production")
    }`,
  );
  lines.push("");

  return lines.join("\n");
}

/**
 * Generates help text for a specific subcommand, listing its arguments,
 * options, and descriptions.
 *
 * @param cmd The subcommand definition to render help for.
 * @param version The current CLI version string.
 * @returns Formatted, colorized help text.
 */
export function subcommandHelp(
  cmd: SubcommandDef,
  version: string,
): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(
    `  ${primary(bold("aai"))} ${interactive(bold(cmd.name))}${
      version ? dim(`  v${version}`) : ""
    }`,
  );
  lines.push(`  ${dim(cmd.description)}`);
  lines.push("");

  if (cmd.args && cmd.args.length > 0) {
    lines.push(`  ${bold(interactive("Arguments"))}`);
    lines.push("");
    for (const arg of cmd.args) {
      const label = arg.optional
        ? primary(`[${arg.name}]`)
        : primary(`<${arg.name}>`);
      lines.push(`    ${label}`);
    }
    lines.push("");
  }

  const visibleOptions = (cmd.options ?? []).filter((o) => !o.hidden);
  if (visibleOptions.length > 0) {
    lines.push(`  ${bold(interactive("Options"))}`);
    lines.push("");
    for (const opt of visibleOptions) {
      lines.push(`    ${interactive(opt.flags)}`);
      lines.push(`      ${dim(opt.description)}`);
    }

    lines.push(`    ${interactive("-h")}${dim(",")} ${interactive("--help")}`);
    lines.push(`      ${dim("Show this help")}`);
    lines.push("");
  }

  return lines.join("\n");
}

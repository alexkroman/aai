import { bold, cyan, dim, green, red, yellow } from "@std/fmt/colors";

// Deno-style right-aligned action prefix width
const PAD = 9;

function fmt(
  action: string,
  color: (s: string) => string,
  msg: string,
): string {
  return `${color(bold(action.padStart(PAD)))} ${msg}`;
}

/** Green bold action prefix + message (positive actions: Bundle, Deploy, etc.) */
export function step(action: string, msg: string): void {
  console.log(fmt(action, green, msg));
}

/** Cyan bold action prefix + message (informational: Watch, Listen, etc.) */
export function stepInfo(action: string, msg: string): void {
  console.log(fmt(action, cyan, msg));
}

/** Dim indented secondary info line, aligned with step detail text. */
export function info(msg: string): void {
  console.log(dim(`${" ".repeat(PAD + 1)}${msg}`));
}

/** Yellow bold "warning" prefix -> stderr. */
export function warn(msg: string): void {
  console.error(fmt("warning", yellow, msg));
}

/** Red bold "error" prefix -> stderr. Deno-style: `error: msg`. */
export function error(msg: string): void {
  console.error(`${red(bold("error"))}: ${msg}`);
}

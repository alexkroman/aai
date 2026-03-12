// Copyright 2025 the AAI authors. MIT license.
import {
  bold,
  brightBlue,
  brightMagenta,
  dim,
  red,
  yellow,
} from "@std/fmt/colors";

// Deno-style right-aligned action prefix width
const PAD = 9;

function fmt(
  action: string,
  color: (s: string) => string,
  msg: string,
): string {
  return `${color(bold(action.padStart(PAD)))} ${msg}`;
}

/**
 * Prints a primary step message with a right-aligned magenta action label.
 *
 * @param action Short action verb (e.g. `"Bundle"`, `"Deploy"`).
 * @param msg Descriptive message printed after the action label.
 */
export function step(action: string, msg: string): void {
  console.log(fmt(action, brightMagenta, msg));
}

/**
 * Prints an informational step message with a right-aligned blue action label.
 *
 * @param action Short action noun (e.g. `"App"`, `"Twilio"`).
 * @param msg Descriptive message printed after the action label.
 */
export function stepInfo(action: string, msg: string): void {
  console.log(fmt(action, brightBlue, msg));
}

/**
 * Prints a dimmed informational line, indented to align with step message text.
 *
 * @param msg The message to print.
 */
export function info(msg: string): void {
  console.log(dim(`${" ".repeat(PAD + 1)}${msg}`));
}

/** Indented line (same alignment as step/stepInfo message text) without dimming. */
export function detail(msg: string): void {
  console.log(`${" ".repeat(PAD + 1)}${msg}`);
}

/**
 * Prints a yellow warning message to stderr.
 *
 * @param msg The warning message.
 */
export function warn(msg: string): void {
  console.error(fmt("warning", yellow, msg));
}

/**
 * Prints a red error message to stderr.
 *
 * @param msg The error message.
 */
export function error(msg: string): void {
  console.error(`${red(bold("error"))}: ${msg}`);
}

import { bold, cyan, dim, red, yellow } from "@std/fmt/colors";

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

const PAD = 9;

function stringify(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function fmt(
  action: string,
  color: (s: string) => string,
  args: unknown[],
): string {
  return `${color(bold(action.padStart(PAD)))} ${
    args.map(stringify).join(" ")
  }`;
}

export function getLogger(name?: string): Logger {
  const tag = name ?? "";
  return {
    debug: (...args: unknown[]) => console.debug(fmt(tag, dim, args)),
    info: (...args: unknown[]) => console.log(fmt(tag, cyan, args)),
    warn: (...args: unknown[]) => console.warn(fmt(tag, yellow, args)),
    error: (...args: unknown[]) => console.error(fmt(tag, red, args)),
  };
}

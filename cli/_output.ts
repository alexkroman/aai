import { blue, bold, cyan, dim, green, red, yellow } from "@std/fmt/colors";

// Deno-style right-aligned action prefix width
const PAD = 9;

function fmt(
  action: string,
  color: (s: string) => string,
  msg: string,
): string {
  return `${color(bold(action.padStart(PAD)))} ${msg}`;
}

/** Spinner frames using filled/empty block characters (Deno-style). */
const SPINNER_FRAMES = [
  "▰▱▱▱▱▱",
  "▰▰▱▱▱▱",
  "▰▰▰▱▱▱",
  "▰▰▰▰▱▱",
  "▰▰▰▰▰▱",
  "▰▰▰▰▰▰",
  "▰▰▰▰▰▰",
  "▱▰▰▰▰▰",
  "▱▱▰▰▰▰",
  "▱▱▱▰▰▰",
  "▱▱▱▱▰▰",
  "▱▱▱▱▱▰",
  "▱▱▱▱▱▱",
];

export interface Spinner {
  stop(finalMsg?: string): void;
}

export const log = {
  /** Green bold action prefix + message (positive actions: Bundle, Deploy, etc.) */
  step(action: string, msg: string): void {
    console.log(fmt(action, green, msg));
  },

  /** Cyan bold action prefix + message (informational: Watch, Listen, etc.) */
  stepInfo(action: string, msg: string): void {
    console.log(fmt(action, cyan, msg));
  },

  /** Dim indented secondary info line, aligned with step detail text. */
  info(msg: string): void {
    console.log(dim(`${" ".repeat(PAD + 1)}${msg}`));
  },

  /** Yellow bold "warning" prefix → stderr. */
  warn(msg: string): void {
    console.error(fmt("warning", yellow, msg));
  },

  /** Red bold "error" prefix → stderr. Deno-style: `error: msg`. */
  error(msg: string): void {
    console.error(`${red(bold("error"))}: ${msg}`);
  },

  /** Indented file size display. */
  size(label: string, bytes: number): void {
    const kb = (bytes / 1024).toFixed(1);
    const pad = " ".repeat(PAD + 1);
    console.log(`${pad}${label}  ${dim(`${kb}KB`)}`);
  },

  /** Indented timing display. */
  timing(label: string, ms: number): void {
    const pad = " ".repeat(PAD + 1);
    console.log(dim(`${pad}${label} in ${Math.round(ms)}ms`));
  },

  /** Render a Deno-style table with box-drawing borders. */
  table(headers: string[], rows: string[][]): void {
    const cols = headers.length;
    const widths = headers.map((h) => h.length);
    for (const row of rows) {
      for (let i = 0; i < cols; i++) {
        widths[i] = Math.max(widths[i], (row[i] || "").length);
      }
    }

    const line = (l: string, m: string, r: string) =>
      l + widths.map((w) => "─".repeat(w + 2)).join(m) + r;
    const pad = (s: string, i: number) => ` ${s.padEnd(widths[i])} `;

    console.log(line("┌", "┬", "┐"));
    console.log(
      "│" + headers.map((h, i) => pad(blue(bold(h)), i)).join("│") + "│",
    );
    console.log(line("├", "┼", "┤"));
    for (const row of rows) {
      console.log(
        "│" + row.map((c, i) => pad(c || "", i)).join("│") + "│",
      );
    }
    console.log(line("└", "┴", "┘"));
  },

  /** Start a Deno-style animated spinner on stderr. Returns handle to stop it. */
  spinner(action: string, msg: string): Spinner {
    let frame = 0;
    const isTty = Deno.stderr.isTerminal();

    if (!isTty) {
      // Non-TTY: just print a static line
      console.error(fmt(action, green, msg));
      return { stop() {} };
    }

    const encoder = new TextEncoder();
    const write = (s: string) => Deno.stderr.writeSync(encoder.encode(s));

    const render = () => {
      const spinner = cyan(SPINNER_FRAMES[frame % SPINNER_FRAMES.length]);
      write(`\r${green(bold(action.padStart(PAD)))} ${spinner} ${msg}`);
      frame++;
    };

    render();
    const id = setInterval(render, 120);

    return {
      stop(finalMsg?: string) {
        clearInterval(id);
        write("\r\x1b[K"); // clear line
        if (finalMsg) {
          console.error(fmt(action, green, finalMsg));
        }
      },
    };
  },

  /** Format a section header (bold). */
  header(title: string): void {
    console.log(bold(title));
  },

  /** Cyan text for file/URL references. */
  cyan,
  /** Dim text for secondary info. */
  dim,
  /** Green text for positive highlights. */
  green,
  /** Bold text for emphasis. */
  bold,
};

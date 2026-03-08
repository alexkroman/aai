import { expect } from "@std/expect";
import { main } from "./cli.ts";

const denoConfig = await import("./deno.json", { with: { type: "json" } });
const VERSION: string = denoConfig.default.version;

function captureConsole(
  fn: (logged: string[]) => void | Promise<void>,
): () => Promise<void> {
  return async () => {
    const logged: string[] = [];
    const origLog = console.log;
    const origError = console.error;
    console.log = (...args: string[]) => logged.push(args.join(" "));
    console.error = () => {};
    try {
      await fn(logged);
    } finally {
      console.log = origLog;
      console.error = origError;
    }
  };
}

Deno.test(
  "cli --version prints version",
  captureConsole(async (logged) => {
    expect(await main(["--version"])).toBe(0);
    expect(logged).toEqual([VERSION]);
  }),
);

Deno.test(
  "cli --help prints usage",
  captureConsole(async (logged) => {
    expect(await main(["--help"])).toBe(0);
    expect(logged[0]).toContain("aai");
  }),
);

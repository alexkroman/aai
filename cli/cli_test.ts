import { expect } from "@std/expect";
import { main } from "./cli.ts";

const denoConfig = await import("../deno.json", { with: { type: "json" } });
const VERSION: string = denoConfig.default.version;

function withConsoleSpy(
  fn: (logged: string[]) => void | Promise<void>,
) {
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

Deno.test("cli main", async (t) => {
  await t.step(
    "prints version with --version",
    withConsoleSpy(async (logged) => {
      expect(await main(["--version"])).toBe(0);
      expect(logged).toEqual([VERSION]);
    }),
  );

  await t.step(
    "prints usage with --help",
    withConsoleSpy(async (logged) => {
      expect(await main(["--help"])).toBe(0);
      expect(logged[0]).toContain("aai");
    }),
  );
});

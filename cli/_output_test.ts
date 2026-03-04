import { expect } from "@std/expect";
import { log } from "./_output.ts";

function spy(target: Console, method: "log" | "error") {
  const calls: string[][] = [];
  const original = target[method].bind(target);
  target[method] = (...args: string[]) => calls.push(args);
  return { calls, restore: () => (target[method] = original) };
}

function withSpies(
  fn: (
    ctx: { logSpy: ReturnType<typeof spy>; errorSpy: ReturnType<typeof spy> },
  ) => void | Promise<void>,
) {
  return async () => {
    const logSpy = spy(console, "log");
    const errorSpy = spy(console, "error");
    try {
      await fn({ logSpy, errorSpy });
    } finally {
      logSpy.restore();
      errorSpy.restore();
    }
  };
}

Deno.test("log helpers", async (t) => {
  await t.step(
    "step writes green bold action prefix to stdout",
    withSpies(({ logSpy }) => {
      log.step("Bundle", "my-agent");
      expect(logSpy.calls.length).toBe(1);
      expect(logSpy.calls[0][0]).toContain("Bundle");
      expect(logSpy.calls[0][0]).toContain("my-agent");
    }),
  );

  await t.step(
    "stepInfo writes cyan bold action prefix to stdout",
    withSpies(({ logSpy }) => {
      log.stepInfo("Watch", "for changes...");
      expect(logSpy.calls.length).toBe(1);
      expect(logSpy.calls[0][0]).toContain("Watch");
      expect(logSpy.calls[0][0]).toContain("for changes...");
    }),
  );

  await t.step(
    "info writes dim indented text to stdout",
    withSpies(({ logSpy }) => {
      log.info("secondary note");
      expect(logSpy.calls.length).toBe(1);
      expect(logSpy.calls[0][0]).toContain("secondary note");
    }),
  );

  await t.step(
    "warn writes to stderr with warning prefix",
    withSpies(({ errorSpy }) => {
      log.warn("careful");
      expect(errorSpy.calls.length).toBe(1);
      expect(errorSpy.calls[0][0]).toContain("warning");
      expect(errorSpy.calls[0][0]).toContain("careful");
    }),
  );

  await t.step(
    "error writes to stderr with error: prefix",
    withSpies(({ errorSpy }) => {
      log.error("oops");
      expect(errorSpy.calls.length).toBe(1);
      expect(errorSpy.calls[0][0]).toContain("error");
      expect(errorSpy.calls[0][0]).toContain("oops");
    }),
  );

  await t.step(
    "size formats bytes as KB",
    withSpies(({ logSpy }) => {
      log.size("worker.js", 2048);
      expect(logSpy.calls.length).toBe(1);
      expect(logSpy.calls[0][0]).toContain("worker.js");
      expect(logSpy.calls[0][0]).toContain("2.0KB");
    }),
  );

  await t.step(
    "timing formats milliseconds",
    withSpies(({ logSpy }) => {
      log.timing("done", 123.4);
      expect(logSpy.calls.length).toBe(1);
      expect(logSpy.calls[0][0]).toContain("done");
      expect(logSpy.calls[0][0]).toContain("123ms");
    }),
  );

  await t.step(
    "header writes bold text to stdout",
    withSpies(({ logSpy }) => {
      log.header("Title");
      expect(logSpy.calls.length).toBe(1);
      expect(logSpy.calls[0][0]).toContain("Title");
    }),
  );

  await t.step(
    "table renders with box-drawing borders",
    withSpies(({ logSpy }) => {
      log.table(["Name", "Value"], [["foo", "bar"]]);
      expect(logSpy.calls.length).toBe(5); // top + header + mid + row + bottom
      expect(logSpy.calls[0][0]).toContain("┌");
      expect(logSpy.calls[1][0]).toContain("Name");
      expect(logSpy.calls[4][0]).toContain("└");
    }),
  );
});

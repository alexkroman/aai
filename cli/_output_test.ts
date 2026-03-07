import { expect } from "@std/expect";
import { error, info, step, stepInfo, warn } from "./_output.ts";

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

Deno.test("output helpers", async (t) => {
  await t.step(
    "step writes green bold action prefix to stdout",
    withSpies(({ logSpy }) => {
      step("Bundle", "my-agent");
      expect(logSpy.calls.length).toBe(1);
      expect(logSpy.calls[0][0]).toContain("Bundle");
      expect(logSpy.calls[0][0]).toContain("my-agent");
    }),
  );

  await t.step(
    "stepInfo writes cyan bold action prefix to stdout",
    withSpies(({ logSpy }) => {
      stepInfo("Watch", "for changes...");
      expect(logSpy.calls.length).toBe(1);
      expect(logSpy.calls[0][0]).toContain("Watch");
      expect(logSpy.calls[0][0]).toContain("for changes...");
    }),
  );

  await t.step(
    "info writes dim indented text to stdout",
    withSpies(({ logSpy }) => {
      info("secondary note");
      expect(logSpy.calls.length).toBe(1);
      expect(logSpy.calls[0][0]).toContain("secondary note");
    }),
  );

  await t.step(
    "warn writes to stderr with warning prefix",
    withSpies(({ errorSpy }) => {
      warn("careful");
      expect(errorSpy.calls.length).toBe(1);
      expect(errorSpy.calls[0][0]).toContain("warning");
      expect(errorSpy.calls[0][0]).toContain("careful");
    }),
  );

  await t.step(
    "error writes to stderr with error: prefix",
    withSpies(({ errorSpy }) => {
      error("oops");
      expect(errorSpy.calls.length).toBe(1);
      expect(errorSpy.calls[0][0]).toContain("error");
      expect(errorSpy.calls[0][0]).toContain("oops");
    }),
  );
});

import { expect } from "@std/expect";
import { error, info, step, stepInfo, warn } from "./_output.ts";

function withSpies(
  fn: (log: string[][], err: string[][]) => void,
): () => void {
  return () => {
    const logCalls: string[][] = [];
    const errCalls: string[][] = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...args: string[]) => logCalls.push(args);
    console.error = (...args: string[]) => errCalls.push(args);
    try {
      fn(logCalls, errCalls);
    } finally {
      console.log = origLog;
      console.error = origErr;
    }
  };
}

Deno.test(
  "step writes action prefix to stdout",
  withSpies((log) => {
    step("Bundle", "my-agent");
    expect(log[0][0]).toContain("Bundle");
    expect(log[0][0]).toContain("my-agent");
  }),
);

Deno.test(
  "stepInfo writes action prefix to stdout",
  withSpies((log) => {
    stepInfo("Watch", "for changes...");
    expect(log[0][0]).toContain("Watch");
  }),
);

Deno.test(
  "info writes to stdout",
  withSpies((log) => {
    info("secondary note");
    expect(log[0][0]).toContain("secondary note");
  }),
);

Deno.test(
  "warn writes to stderr",
  withSpies((_log, err) => {
    warn("careful");
    expect(err[0][0]).toContain("careful");
  }),
);

Deno.test(
  "error writes to stderr",
  withSpies((_log, err) => {
    error("oops");
    expect(err[0][0]).toContain("oops");
  }),
);

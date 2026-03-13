// Copyright 2025 the AAI authors. MIT license.
import { assertStringIncludes } from "@std/assert";
import { assertSpyCalls, stub } from "@std/testing/mock";
import { error, info, step, stepInfo, warn } from "./_output.ts";

Deno.test("step writes action prefix to stdout", () => {
  using logStub = stub(console, "log");
  step("Bundle", "my-agent");
  assertSpyCalls(logStub, 1);
  assertStringIncludes(logStub.calls[0]!.args[0], "Bundle");
  assertStringIncludes(logStub.calls[0]!.args[0], "my-agent");
});

Deno.test("stepInfo writes action prefix to stdout", () => {
  using logStub = stub(console, "log");
  stepInfo("Watch", "for changes...");
  assertSpyCalls(logStub, 1);
  assertStringIncludes(logStub.calls[0]!.args[0], "Watch");
});

Deno.test("info writes to stdout", () => {
  using logStub = stub(console, "log");
  info("secondary note");
  assertSpyCalls(logStub, 1);
  assertStringIncludes(logStub.calls[0]!.args[0], "secondary note");
});

Deno.test("warn writes to stderr", () => {
  using errStub = stub(console, "error");
  warn("careful");
  assertSpyCalls(errStub, 1);
  assertStringIncludes(errStub.calls[0]!.args[0], "careful");
});

Deno.test("error writes to stderr", () => {
  using errStub = stub(console, "error");
  error("oops");
  assertSpyCalls(errStub, 1);
  assertStringIncludes(errStub.calls[0]!.args[0], "oops");
});

// Copyright 2025 the AAI authors. MIT license.
import { assertStringIncludes } from "@std/assert";
import { assertSpyCalls, stub } from "@std/testing/mock";
import { error, info, step, stepInfo, warn } from "./_output.ts";

Deno.test("step writes action prefix to stdout", () => {
  const logStub = stub(console, "log");
  try {
    step("Bundle", "my-agent");
    assertSpyCalls(logStub, 1);
    assertStringIncludes(logStub.calls[0]!.args[0], "Bundle");
    assertStringIncludes(logStub.calls[0]!.args[0], "my-agent");
  } finally {
    logStub.restore();
  }
});

Deno.test("stepInfo writes action prefix to stdout", () => {
  const logStub = stub(console, "log");
  try {
    stepInfo("Watch", "for changes...");
    assertSpyCalls(logStub, 1);
    assertStringIncludes(logStub.calls[0]!.args[0], "Watch");
  } finally {
    logStub.restore();
  }
});

Deno.test("info writes to stdout", () => {
  const logStub = stub(console, "log");
  try {
    info("secondary note");
    assertSpyCalls(logStub, 1);
    assertStringIncludes(logStub.calls[0]!.args[0], "secondary note");
  } finally {
    logStub.restore();
  }
});

Deno.test("warn writes to stderr", () => {
  const errStub = stub(console, "error");
  try {
    warn("careful");
    assertSpyCalls(errStub, 1);
    assertStringIncludes(errStub.calls[0]!.args[0], "careful");
  } finally {
    errStub.restore();
  }
});

Deno.test("error writes to stderr", () => {
  const errStub = stub(console, "error");
  try {
    error("oops");
    assertSpyCalls(errStub, 1);
    assertStringIncludes(errStub.calls[0]!.args[0], "oops");
  } finally {
    errStub.restore();
  }
});

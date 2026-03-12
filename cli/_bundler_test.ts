// Copyright 2025 the AAI authors. MIT license.
import {
  assert,
  assertInstanceOf,
  assertMatch,
  assertStrictEquals,
} from "@std/assert";
import { resolve } from "@std/path";
import { _internals, AAI_ROOT } from "./_bundler.ts";

const {
  WORKSPACE_ALIASES,
  BundleError,
  getConfigPath,
  getOutputText,
  jsBytes,
  buildNpmAliases,
} = _internals;

// --- BundleError ---

Deno.test("BundleError: creates error with BundleError name", () => {
  const err = new BundleError("something went wrong");
  assertInstanceOf(err, Error);
  assertInstanceOf(err, BundleError);
  assertStrictEquals(err.name, "BundleError");
  assertStrictEquals(err.message, "something went wrong");
});

// --- WORKSPACE_ALIASES ---

Deno.test("WORKSPACE_ALIASES: maps @aai/sdk to sdk/mod.ts", () => {
  assertStrictEquals(
    WORKSPACE_ALIASES["@aai/sdk"],
    resolve(AAI_ROOT, "sdk/mod.ts"),
  );
});

Deno.test("WORKSPACE_ALIASES: maps @aai/sdk/types to sdk/types.ts", () => {
  assertStrictEquals(
    WORKSPACE_ALIASES["@aai/sdk/types"],
    resolve(AAI_ROOT, "sdk/types.ts"),
  );
});

Deno.test("WORKSPACE_ALIASES: maps @aai/core/protocol to core/_protocol.ts", () => {
  assertStrictEquals(
    WORKSPACE_ALIASES["@aai/core/protocol"],
    resolve(AAI_ROOT, "core/_protocol.ts"),
  );
});

Deno.test("WORKSPACE_ALIASES: maps @aai/ui to ui/mod.ts", () => {
  assertStrictEquals(
    WORKSPACE_ALIASES["@aai/ui"],
    resolve(AAI_ROOT, "ui/mod.ts"),
  );
});

Deno.test("WORKSPACE_ALIASES: all values are absolute paths under AAI_ROOT", () => {
  for (const [key, value] of Object.entries(WORKSPACE_ALIASES)) {
    assertStrictEquals(value.startsWith(AAI_ROOT), true);
    assertMatch(value, /\.ts$/);
    // Key should be an @aai/ specifier
    assertStrictEquals(key.startsWith("@aai/"), true);
  }
});

// --- getConfigPath ---

Deno.test("getConfigPath: returns root deno.json when it exists", () => {
  const configPath = getConfigPath();
  assertStrictEquals(configPath, resolve(AAI_ROOT, "deno.json"));
});

// --- getOutputText ---

Deno.test("getOutputText: returns first output file text", () => {
  const result = {
    outputFiles: [{ path: "out.js", text: "console.log('hi')" }],
  };
  assertStrictEquals(getOutputText(result), "console.log('hi')");
});

Deno.test("getOutputText: returns empty string when no output files", () => {
  assertStrictEquals(getOutputText({}), "");
  assertStrictEquals(getOutputText({ outputFiles: [] }), "");
});

// --- jsBytes ---

Deno.test("jsBytes: returns bytes for .js output", () => {
  const metafile = {
    outputs: {
      "out.js": { bytes: 1234 },
      "out.js.map": { bytes: 5678 },
    },
  };
  assertStrictEquals(jsBytes(metafile), 1234);
});

Deno.test("jsBytes: returns 0 when no .js output", () => {
  const metafile = { outputs: { "out.css": { bytes: 100 } } };
  assertStrictEquals(jsBytes(metafile), 0);
});

// --- buildNpmAliases ---

Deno.test("buildNpmAliases: resolves known npm packages", () => {
  const aliases = buildNpmAliases();
  // These packages should exist in node_modules
  assert(aliases["preact"] !== undefined);
  assertStrictEquals(aliases["preact"]!.includes("node_modules"), true);
  assert(aliases["htm"] !== undefined);
  assert(aliases["comlink"] !== undefined);
});

Deno.test("buildNpmAliases: resolves scoped packages", () => {
  const aliases = buildNpmAliases();
  // @preact/signals is a scoped package
  assert(aliases["@preact/signals"] !== undefined);
});

Deno.test("buildNpmAliases: resolves subpath packages", () => {
  const aliases = buildNpmAliases();
  // preact/hooks is a subpath
  assert(aliases["preact/hooks"] !== undefined);
});

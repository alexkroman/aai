#!/usr/bin/env -S deno run --allow-all
// Copyright 2025 the AAI authors. MIT license.
/**
 * Tests every template by scaffolding into a temp directory and running
 * a dry-run deploy via the CLI, exactly as a user would.
 *
 * This script shells out to the CLI binary — it never imports internal
 * modules, so it can't accidentally be bundled into the compiled CLI.
 */

import { bold, brightMagenta, red } from "@std/fmt/colors";
import * as log from "@std/log";
import { dirname, fromFileUrl, join } from "@std/path";

const ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");
const CLI = join(ROOT, "cli", "cli.ts");
const TEMPLATES_DIR = join(ROOT, "cli", "templates");
const DENO_RUN = [
  Deno.execPath(),
  "run",
  "--allow-all",
  "--unstable-worker-options",
  CLI,
];

// Discover templates
const templates: string[] = [];
for await (const entry of Deno.readDir(TEMPLATES_DIR)) {
  if (entry.isDirectory && !entry.name.startsWith("_")) {
    templates.push(entry.name);
  }
}
templates.sort();

log.info(`Testing ${templates.length} templates...\n`);

// Ensure ASSEMBLYAI_API_KEY is set
if (!Deno.env.get("ASSEMBLYAI_API_KEY")) {
  Deno.env.set("ASSEMBLYAI_API_KEY", "test");
}

const results: { name: string; ok: boolean; error?: string }[] = [];

for (const template of templates) {
  const tmpDir = await Deno.makeTempDir({ prefix: `aai-test-${template}-` });

  try {
    // Scaffold using the CLI (non-interactive with -y)
    const scaffold = new Deno.Command(DENO_RUN[0]!, {
      args: [
        ...DENO_RUN.slice(1),
        "new",
        "-t",
        template,
        "-n",
        "Test Agent",
        "-y",
        "--force",
      ],
      cwd: tmpDir,
      env: { ...Deno.env.toObject(), INIT_CWD: tmpDir },
      stdout: "piped",
      stderr: "piped",
    });
    const scaffoldResult = await scaffold.output();
    if (!scaffoldResult.success) {
      const stderr = new TextDecoder().decode(scaffoldResult.stderr);
      throw new Error(`Scaffold failed: ${stderr}`);
    }

    // Install dependencies
    const install = new Deno.Command(Deno.execPath(), {
      args: ["install"],
      cwd: tmpDir,
      stdout: "piped",
      stderr: "piped",
    });
    const installResult = await install.output();
    if (!installResult.success) {
      throw new Error("Deno install failed");
    }

    // Dry-run deploy (includes typecheck, lint, fmt via cli/build.ts)
    const deploy = new Deno.Command(DENO_RUN[0]!, {
      args: [...DENO_RUN.slice(1), "deploy", "--dry-run", "-y"],
      cwd: tmpDir,
      env: { ...Deno.env.toObject(), INIT_CWD: tmpDir },
      stdout: "piped",
      stderr: "piped",
    });
    const deployResult = await deploy.output();
    if (!deployResult.success) {
      const stderr = new TextDecoder().decode(deployResult.stderr);
      throw new Error(`Deploy dry-run failed: ${stderr}`);
    }

    log.info(`  ${brightMagenta("✓")} ${template}`);
    results.push({ name: template, ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.info(`  ${red("✗")} ${template}`);
    log.info(`    ${msg}`);
    results.push({ name: template, ok: false, error: msg });
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
}

log.info("");
const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok).length;

if (failed === 0) {
  log.info(bold(brightMagenta(`All ${passed} templates passed.`)));
} else {
  log.info(bold(red(`${failed} of ${results.length} templates failed.`)));
  Deno.exit(1);
}

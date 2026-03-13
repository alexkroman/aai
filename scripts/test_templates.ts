#!/usr/bin/env -S deno run --allow-all
// Copyright 2025 the AAI authors. MIT license.
/**
 * Tests every template by:
 * 1. Starting a local dev server
 * 2. Scaffolding each template into a temp directory
 * 3. Deploying each template to the local server
 * 4. Hitting each template's health check endpoint
 *
 * This script shells out to the CLI binary — it never imports internal
 * modules, so it can't accidentally be bundled into the compiled CLI.
 */

import { bold, brightMagenta, red } from "@std/fmt/colors";
import * as log from "@std/log";
import { dirname, fromFileUrl, join } from "@std/path";
import { deadline } from "@std/async/deadline";

const ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");
const CLI = join(ROOT, "cli", "cli.ts");
const SERVER = join(ROOT, "server", "main.ts");
const TEMPLATES_DIR = join(ROOT, "templates");
const DENO = Deno.execPath();
const DENO_RUN = [
  DENO,
  "run",
  "--allow-all",
  "--unstable-worker-options",
  CLI,
];
const PORT = 3199; // Use a non-default port to avoid conflicts
const BASE_URL = `http://localhost:${PORT}`;

// Timeout for each scaffold+deploy step (3 minutes should be plenty)
const STEP_TIMEOUT_MS = 180_000;

// Ensure ASSEMBLYAI_API_KEY is set
if (!Deno.env.get("ASSEMBLYAI_API_KEY")) {
  Deno.env.set("ASSEMBLYAI_API_KEY", "test");
}

// Discover templates
const templates: string[] = [];
for await (const entry of Deno.readDir(TEMPLATES_DIR)) {
  if (entry.isDirectory && !entry.name.startsWith("_")) {
    templates.push(entry.name);
  }
}
templates.sort();

log.info(`Testing ${templates.length} templates...\n`);

// --- Start local server ---
log.info("Starting local dev server...");
const serverProcess = new Deno.Command(DENO, {
  args: ["run", "--allow-all", "--unstable-worker-options", SERVER],
  env: { ...Deno.env.toObject(), PORT: String(PORT) },
  stdout: "piped",
  stderr: "piped",
}).spawn();

// Wait for server to be ready
const maxWait = 15_000;
const start = Date.now();
let serverReady = false;
while (Date.now() - start < maxWait) {
  try {
    const resp = await fetch(`${BASE_URL}/health`);
    if (resp.ok) {
      serverReady = true;
      break;
    }
  } catch {
    // Server not ready yet
  }
  await new Promise((r) => setTimeout(r, 200));
}

if (!serverReady) {
  log.error("Server failed to start within 15s");
  serverProcess.kill("SIGTERM");
  Deno.exit(1);
}
log.info(`Server ready on port ${PORT}\n`);

// --- Pre-install shared node_modules once ---
// All templates share the same npm dependencies. Install once and symlink
// to each temp dir so we don't re-download ~100 packages per template.
log.info("Pre-installing shared dependencies...");
const sharedDir = await Deno.makeTempDir({ prefix: "aai-test-shared-" });
const sharedScaffold = new Deno.Command(DENO_RUN[0]!, {
  args: [...DENO_RUN.slice(1), "new", "-t", "simple", "-y", "--force"],
  cwd: sharedDir,
  env: { ...Deno.env.toObject(), INIT_CWD: sharedDir },
  stdout: "piped",
  stderr: "piped",
});
const sharedResult = await deadline(sharedScaffold.output(), STEP_TIMEOUT_MS);
if (!sharedResult.success) {
  const stderr = new TextDecoder().decode(sharedResult.stderr);
  log.error(`Failed to pre-install dependencies: ${stderr}`);
  serverProcess.kill("SIGTERM");
  Deno.exit(1);
}
const sharedNodeModules = join(sharedDir, "node_modules");
log.info("Dependencies ready.\n");

/** Run a command with a timeout. Returns { success, stderr }. */
async function run(
  args: string[],
  cwd: string,
): Promise<{ success: boolean; stderr: string }> {
  const cmd = new Deno.Command(args[0]!, {
    args: args.slice(1),
    cwd,
    env: { ...Deno.env.toObject(), INIT_CWD: cwd },
    stdout: "piped",
    stderr: "piped",
  });
  const result = await deadline(cmd.output(), STEP_TIMEOUT_MS);
  return {
    success: result.success,
    stderr: new TextDecoder().decode(result.stderr),
  };
}

// --- Scaffold, deploy, and health-check each template ---
const results: { name: string; ok: boolean; slug?: string; error?: string }[] =
  [];

for (const template of templates) {
  const tmpDir = await Deno.makeTempDir({ prefix: `aai-test-${template}-` });

  try {
    // Scaffold
    log.info(`  ${template}: scaffolding...`);
    const scaffold = await run(
      [...DENO_RUN, "new", "-t", template, "-y", "--force"],
      tmpDir,
    );
    if (!scaffold.success) {
      throw new Error(`Scaffold failed: ${scaffold.stderr}`);
    }

    // Symlink shared node_modules if the scaffold created its own
    // (ensureDependencies skips if node_modules exists, but if it ran
    // and installed fresh, replace with symlink for consistency)
    const tmpNodeModules = join(tmpDir, "node_modules");
    try {
      await Deno.remove(tmpNodeModules, { recursive: true });
    } catch {
      // Doesn't exist yet — fine
    }
    await Deno.symlink(sharedNodeModules, tmpNodeModules);

    // Deploy to local server
    log.info(`  ${template}: deploying...`);
    const deploy = await run(
      [...DENO_RUN, "deploy", "-y", "-s", BASE_URL],
      tmpDir,
    );
    if (!deploy.success) {
      throw new Error(`Deploy failed: ${deploy.stderr}`);
    }

    // Extract slug from .aai/project.json
    const projectJson = JSON.parse(
      await Deno.readTextFile(join(tmpDir, ".aai", "project.json")),
    );
    const slug = projectJson.slug as string;

    // Health check
    const healthResp = await fetch(`${BASE_URL}/${slug}/health`);
    if (!healthResp.ok) {
      throw new Error(`Health check returned ${healthResp.status}`);
    }
    const health = await healthResp.json();
    if (health.status !== "ok") {
      throw new Error(`Health check status: ${JSON.stringify(health)}`);
    }

    log.info(`  ${brightMagenta("✓")} ${template} (${slug})`);
    results.push({ name: template, ok: true, slug });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.info(`  ${red("✗")} ${template}`);
    log.info(`    ${msg.slice(0, 500)}`);
    results.push({ name: template, ok: false, error: msg });
  } finally {
    await Deno.remove(tmpDir, { recursive: true }).catch(() => {});
  }
}

// --- Cleanup ---
serverProcess.kill("SIGTERM");
try {
  await serverProcess.status;
} catch {
  // Expected — process terminated
}
await Deno.remove(sharedDir, { recursive: true }).catch(() => {});

// --- Summary ---
log.info("");
const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok).length;

if (failed === 0) {
  log.info(bold(brightMagenta(`All ${passed} templates passed.`)));
} else {
  log.info(bold(red(`${failed} of ${results.length} templates failed:`)));
  for (const r of results.filter((r) => !r.ok)) {
    log.info(`  ${red("✗")} ${r.name}: ${r.error?.slice(0, 200)}`);
  }
  Deno.exit(1);
}

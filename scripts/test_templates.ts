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

const ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");
const CLI = join(ROOT, "cli", "cli.ts");
const SERVER = join(ROOT, "server", "main.ts");
const TEMPLATES_DIR = join(ROOT, "templates");
const DENO = Deno.execPath();
const DENO_RUN = [DENO, "run", "--allow-all", "--unstable-worker-options", CLI];
const PORT = 3199; // Use a non-default port to avoid conflicts
const BASE_URL = `http://localhost:${PORT}`;

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

// --- Scaffold, deploy, and health-check each template ---
const results: { name: string; ok: boolean; slug?: string; error?: string }[] =
  [];

for (const template of templates) {
  const tmpDir = await Deno.makeTempDir({ prefix: `aai-test-${template}-` });

  try {
    // Scaffold
    const scaffold = new Deno.Command(DENO_RUN[0]!, {
      args: [...DENO_RUN.slice(1), "new", "-t", template, "-y", "--force"],
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

    // Deploy to local server
    const deploy = new Deno.Command(DENO_RUN[0]!, {
      args: [...DENO_RUN.slice(1), "deploy", "-y", "-s", BASE_URL],
      cwd: tmpDir,
      env: { ...Deno.env.toObject(), INIT_CWD: tmpDir },
      stdout: "piped",
      stderr: "piped",
    });
    const deployResult = await deploy.output();
    if (!deployResult.success) {
      const stderr = new TextDecoder().decode(deployResult.stderr);
      throw new Error(`Deploy failed: ${stderr}`);
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
    log.info(`    ${msg}`);
    results.push({ name: template, ok: false, error: msg });
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
}

// --- Shutdown server ---
serverProcess.kill("SIGTERM");
try {
  await serverProcess.status;
} catch {
  // Expected — process terminated
}

// --- Summary ---
log.info("");
const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok).length;

if (failed === 0) {
  log.info(bold(brightMagenta(`All ${passed} templates passed.`)));
} else {
  log.info(bold(red(`${failed} of ${results.length} templates failed:`)));
  for (const r of results.filter((r) => !r.ok)) {
    log.info(`  ${red("✗")} ${r.name}: ${r.error}`);
  }
  Deno.exit(1);
}

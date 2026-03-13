// Copyright 2025 the AAI authors. MIT license.
import { exists } from "@std/fs/exists";
import { basename, join, resolve } from "@std/path";
import { step } from "./_output.ts";

export const _internals = {
  step,
};

export type NewOptions = {
  targetDir: string;
  template: string;
  templatesDir: string;
};

/** Names to skip when copying template directories. */
const SKIP = new Set(["node_modules", "_deno.json"]);

export async function listTemplates(dir: string): Promise<string[]> {
  const templates: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isDirectory && entry.name !== "shared") {
      templates.push(entry.name);
    }
  }
  return templates.sort();
}

/** Recursively copy `src` into `dest`, skipping names in SKIP. */
async function copyDir(src: string, dest: string): Promise<void> {
  await Deno.mkdir(dest, { recursive: true });
  for await (const entry of Deno.readDir(src)) {
    if (SKIP.has(entry.name)) continue;
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory) {
      await copyDir(srcPath, destPath);
    } else {
      await Deno.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Copy all files from `src` into `dest`, skipping files that already exist
 * in `dest` so that template-specific files take precedence over shared ones.
 */
async function copyDirNoOverwrite(src: string, dest: string): Promise<void> {
  await Deno.mkdir(dest, { recursive: true });
  for await (const entry of Deno.readDir(src)) {
    if (SKIP.has(entry.name)) continue;
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory) {
      await copyDirNoOverwrite(srcPath, destPath);
    } else if (!await exists(destPath)) {
      await Deno.copyFile(srcPath, destPath);
    }
  }
}

export async function runNew(opts: NewOptions): Promise<string> {
  const { targetDir, template, templatesDir } = opts;
  const available = await listTemplates(templatesDir);

  if (!available.includes(template)) {
    throw new Error(
      `unknown template '${template}' -- available: ${available.join(", ")}`,
    );
  }

  _internals.step("Create", `from template '${template}'`);

  // 1. Copy template-specific files first (skip node_modules, _deno.json)
  await copyDir(join(templatesDir, template), targetDir);

  // 2. Layer shared files underneath (don't overwrite template files)
  await copyDirNoOverwrite(join(templatesDir, "shared"), targetDir);

  // 3. Rename .tmpl files (stored with .tmpl extension to avoid deno compile resolution)
  for await (const entry of Deno.readDir(targetDir)) {
    if (entry.isFile && entry.name.endsWith(".tmpl")) {
      const dest = entry.name.slice(0, -".tmpl".length);
      const destPath = join(targetDir, dest);
      if (!await exists(destPath)) {
        await Deno.rename(join(targetDir, entry.name), destPath);
      }
    }
  }

  try {
    await Deno.copyFile(
      join(targetDir, ".env.example"),
      join(targetDir, ".env"),
    );
  } catch { /* no .env.example in template */ }

  // Generate README.md with getting-started instructions
  const slug = basename(resolve(targetDir));
  const readme = `# ${slug}

A voice agent built with [aai](https://github.com/anthropics/aai).

## Getting started

\`\`\`sh
npm install        # Install dependencies
npm run dev        # Run locally (opens browser)
npm run deploy     # Deploy to production
\`\`\`

## Environment variables

Secrets are managed on the server, not in local files:

\`\`\`sh
aai env add MY_KEY # Set a secret (prompts for value)
aai env ls         # List secret names
aai env pull       # Pull names into .env for reference
aai env rm MY_KEY  # Remove a secret
\`\`\`

Access secrets in your agent via \`ctx.env.MY_KEY\`.

## Learn more

See \`CLAUDE.md\` for the full agent API reference.
`;
  await Deno.writeTextFile(join(targetDir, "README.md"), readme);

  _internals.step("Done", targetDir);
  return targetDir;
}

// Copyright 2025 the AAI authors. MIT license.
import { join } from "@std/path";
import { step } from "./_output.ts";

export const _internals = {
  step,
};

export type NewOptions = {
  targetDir: string;
  template: string;
  templatesDir: string;
  name?: string;
};

export async function listTemplates(dir: string): Promise<string[]> {
  const templates: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isDirectory) templates.push(entry.name);
  }
  return templates.sort();
}

async function copyDir(src: string, dest: string): Promise<void> {
  await Deno.mkdir(dest, { recursive: true });
  for await (const entry of Deno.readDir(src)) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory) {
      await copyDir(srcPath, destPath);
    } else {
      await Deno.copyFile(srcPath, destPath);
    }
  }
}

export async function runNew(opts: NewOptions): Promise<string> {
  const { targetDir, template, templatesDir, name } = opts;
  const available = await listTemplates(templatesDir);

  if (!available.includes(template)) {
    throw new Error(
      `unknown template '${template}' -- available: ${available.join(", ")}`,
    );
  }

  const src = join(templatesDir, template);

  _internals.step("Create", `from template '${template}'`);

  await Deno.mkdir(targetDir, { recursive: true });

  for await (const entry of Deno.readDir(src)) {
    if (entry.name === "node_modules") continue;
    const srcPath = join(src, entry.name);
    const destPath = join(targetDir, entry.name);
    if (entry.isDirectory) {
      await copyDir(srcPath, destPath);
    } else {
      await Deno.copyFile(srcPath, destPath);
    }
  }

  if (name) {
    const agentPath = join(targetDir, "agent.ts");
    const content = await Deno.readTextFile(agentPath);
    const escaped = name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const updated = content.replace(
      /^(\s*name:\s*)"[^"]*"/m,
      `$1"${escaped}"`,
    );
    await Deno.writeTextFile(agentPath, updated);
  }

  try {
    await Deno.copyFile(
      join(targetDir, ".env.example"),
      join(targetDir, ".env"),
    );
  } catch { /* no .env.example in template */ }

  // Generate README.md with getting-started instructions
  const agentName = name ?? "My Agent";
  const readme = `# ${agentName}

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

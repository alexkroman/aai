import { join } from "@std/path";
import { step } from "./_output.ts";

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

  step("Create", `from template '${template}'`);

  await Deno.mkdir(targetDir, { recursive: true });

  for await (const entry of Deno.readDir(src)) {
    if (entry.name === "node_modules") continue;
    const srcPath = join(src, entry.name);
    // _deno.json/_package.json stored with underscore to avoid workspace conflicts
    const destName = entry.name === "_deno.json" ? "deno.json" : entry.name;
    const destPath = join(targetDir, destName);
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

  // Copy generated .d.ts type stubs for IDE autocomplete
  const typesDir = join(templatesDir, "..", "cli", "_generated_types");
  try {
    for await (const entry of Deno.readDir(typesDir)) {
      if (entry.name.endsWith(".d.ts")) {
        await Deno.copyFile(
          join(typesDir, entry.name),
          join(targetDir, entry.name),
        );
      }
    }
  } catch { /* generated types not found — skip */ }

  step("Done", targetDir);
  return targetDir;
}

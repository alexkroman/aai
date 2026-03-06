import { join } from "@std/path";
import { step } from "./_output.ts";
import { generateTypes } from "./types.ts";
import {
  adjectives,
  animals,
  type Config,
  uniqueNamesGenerator,
} from "unique-names-generator";

const slugConfig: Config = {
  dictionaries: [adjectives, animals],
  separator: "-",
  length: 2,
  style: "lowerCase",
};

/** Generate a unique, memorable slug like "calm-fox" or "bright-creek". */
export function generateSlug(): string {
  return uniqueNamesGenerator(slugConfig);
}

export interface NewOptions {
  slug: string;
  targetDir: string;
  template: string;
  templatesDir: string;
}

async function listTemplates(dir: string): Promise<string[]> {
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
  const { slug, targetDir, template, templatesDir } = opts;
  const available = await listTemplates(templatesDir);

  if (!available.includes(template)) {
    throw new Error(
      `unknown template '${template}' -- available: ${available.join(", ")}`,
    );
  }

  const src = join(templatesDir, template);

  step("Create", `${slug} from template '${template}'`);

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

  // Update slug in agent.json
  const agentJsonPath = join(targetDir, "agent.json");
  try {
    const raw = await Deno.readTextFile(agentJsonPath);
    const config = JSON.parse(raw);
    config.slug = slug;
    await Deno.writeTextFile(
      agentJsonPath,
      JSON.stringify(config, null, 2) + "\n",
    );
  } catch {
    // No agent.json to update
  }

  await generateTypes(targetDir);

  // Copy .env.example as .env
  try {
    await Deno.copyFile(
      join(targetDir, ".env.example"),
      join(targetDir, ".env"),
    );
  } catch {
    // No .env.example in template
  }

  step("Done", targetDir);
  return targetDir;
}

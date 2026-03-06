import { parse as parseDotenv } from "@std/dotenv/parse";
import { exists } from "@std/fs/exists";
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { toFileUrl } from "@std/path/to-file-url";
import { step } from "./_output.ts";
import { stripTypes } from "./_bundler.ts";
import type { AgentDef } from "../sdk/types.ts";

/** Root of the aai framework (parent of cli/). */
const AAI_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..");

// -- API key config -----------------------------------------------------------

const CONFIG_DIR = join(
  Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? ".",
  ".config",
  "aai",
);
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

interface CliConfig {
  assemblyai_api_key?: string;
}

async function readConfig(): Promise<CliConfig> {
  try {
    return JSON.parse(await Deno.readTextFile(CONFIG_FILE));
  } catch {
    return {};
  }
}

async function writeConfig(config: CliConfig): Promise<void> {
  await Deno.mkdir(CONFIG_DIR, { recursive: true });
  await Deno.writeTextFile(
    CONFIG_FILE,
    JSON.stringify(config, null, 2) + "\n",
  );
}

/** Get the stored API key, prompting the user if not set. */
export async function getApiKey(): Promise<string> {
  const envKey = Deno.env.get("ASSEMBLYAI_API_KEY");
  if (envKey) return envKey;

  const config = await readConfig();
  if (config.assemblyai_api_key) return config.assemblyai_api_key;

  step("Setup", "AssemblyAI API key required for speech-to-text");
  console.log("Get one at https://www.assemblyai.com/dashboard/signup\n");
  const key = prompt("Enter your ASSEMBLYAI_API_KEY:")?.trim();
  if (!key) {
    throw new Error("ASSEMBLYAI_API_KEY is required");
  }

  config.assemblyai_api_key = key;
  await writeConfig(config);
  step("Saved", CONFIG_FILE);
  return key;
}

// -- Agent discovery ----------------------------------------------------------

export interface AgentEntry {
  slug: string;
  dir: string;
  entryPoint: string;
  env: Record<string, string>;
  clientEntry: string;
  transport: ("websocket" | "twilio")[];
}

/** Check if the agent has external imports in its deno.json. */
async function hasExternalImports(dir: string): Promise<boolean> {
  const denoJsonPath = join(dir, "deno.json");
  if (!await exists(denoJsonPath)) return false;
  try {
    const raw = JSON.parse(await Deno.readTextFile(denoJsonPath));
    return raw.imports && Object.keys(raw.imports).length > 0;
  } catch {
    return false;
  }
}

/** Import agent.ts and return the AgentDef, or null if external imports prevent it. */
async function importAgentDef(dir: string): Promise<AgentDef | null> {
  if (await hasExternalImports(dir)) return null;

  const entryPoint = join(dir, "agent.ts");
  const saved = {
    defineAgent: (globalThis as Record<string, unknown>).defineAgent,
    fetchJSON: (globalThis as Record<string, unknown>).fetchJSON,
    z: (globalThis as Record<string, unknown>).z,
  };

  const tmpPath = join(dir, `.aai-discover-${Date.now()}.js`);
  try {
    const { defineAgent } = await import("../sdk/define_agent.ts");
    const { fetchJSON } = await import("../sdk/fetch_json.ts");
    const { z } = await import("zod");
    Object.assign(globalThis, { defineAgent, fetchJSON, z });

    const source = await Deno.readTextFile(resolve(entryPoint));
    const js = await stripTypes(source);
    await Deno.writeTextFile(tmpPath, js);
    const mod = await import(toFileUrl(tmpPath).href);
    return mod.default as AgentDef;
  } finally {
    await Deno.remove(tmpPath).catch(() => {});
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) {
        delete (globalThis as Record<string, unknown>)[k];
      } else {
        (globalThis as Record<string, unknown>)[k] = v;
      }
    }
  }
}

export async function loadAgent(dir: string): Promise<AgentEntry | null> {
  const hasAgentTs = await exists(join(dir, "agent.ts"));
  if (!hasAgentTs) return null;

  // Try to import agent.ts to read slug/env/transport from defineAgent()
  const def = await importAgentDef(dir);

  // For agents with external imports, fall back to directory name for slug
  const slug = def?.slug ?? dirname(resolve(dir)).split("/").pop() ??
    "agent";
  const declared: readonly string[] = def?.env ?? ["ASSEMBLYAI_API_KEY"];
  const transport = def?.transport
    ? [...def.transport] as ("websocket" | "twilio")[]
    : ["websocket"] as ("websocket" | "twilio")[];

  const dotenvText = await Deno.readTextFile(join(dir, ".env")).catch(() => "");
  const dotenv = parseDotenv(dotenvText);

  const env: Record<string, string> = {};
  const missing: string[] = [];

  for (const key of declared) {
    const resolved = dotenv[key] ?? Deno.env.get(key);
    if (resolved === undefined) {
      missing.push(key);
    } else {
      env[key] = resolved;
    }
  }

  if (missing.includes("ASSEMBLYAI_API_KEY")) {
    env.ASSEMBLYAI_API_KEY = await getApiKey();
    missing.splice(missing.indexOf("ASSEMBLYAI_API_KEY"), 1);
  }

  if (missing.length > 0) {
    const hasEnvFile = await exists(join(dir, ".env"));
    const hint = hasEnvFile
      ? `Add them to .env:\n\n${missing.map((k) => `  ${k}=`).join("\n")}\n`
      : `Create a .env file:\n\n${missing.map((k) => `  ${k}=`).join("\n")}\n`;
    throw new Error(
      `missing env vars required by agent: ${missing.join(", ")}\n\n${hint}`,
    );
  }

  const clientEntry = await exists(join(dir, "client.tsx"))
    ? join(dir, "client.tsx")
    : resolve(AAI_ROOT, "ui/client.tsx");

  return {
    slug,
    dir,
    entryPoint: join(dir, "agent.ts"),
    env,
    clientEntry,
    transport,
  };
}

import { parse as parseDotenv } from "@std/dotenv/parse";
import { exists } from "@std/fs/exists";
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { toFileUrl } from "@std/path/to-file-url";
import { step } from "./_output.ts";
import { stripTypes } from "./_bundler.ts";
import { type AgentDef, agentToolsToSchemas } from "../sdk/types.ts";

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
  rime_api_key?: string;
  brave_api_key?: string;
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

interface KeySpec {
  envVar: string;
  configKey: keyof CliConfig;
  label: string;
  prompt: string;
  signupUrl: string;
}

const KEYS: KeySpec[] = [
  {
    envVar: "ASSEMBLYAI_API_KEY",
    configKey: "assemblyai_api_key",
    label: "AssemblyAI API key required for speech-to-text",
    prompt: "Enter your ASSEMBLYAI_API_KEY:",
    signupUrl: "https://www.assemblyai.com/dashboard/signup",
  },
  {
    envVar: "RIME_API_KEY",
    configKey: "rime_api_key",
    label: "Rime API key required for text-to-speech",
    prompt: "Enter your RIME_API_KEY:",
    signupUrl: "https://rime.ai",
  },
  {
    envVar: "BRAVE_API_KEY",
    configKey: "brave_api_key",
    label: "Brave API key required for web search",
    prompt: "Enter your BRAVE_API_KEY:",
    signupUrl: "https://brave.com/search/api/",
  },
];

/** Ensure all required API keys are available, prompting if needed.
 *  Sets env vars so the embedded server can read them. */
export async function getApiKeys(): Promise<void> {
  const config = await readConfig();
  let dirty = false;

  for (const spec of KEYS) {
    const envVal = Deno.env.get(spec.envVar);
    if (envVal) continue;

    const stored = config[spec.configKey];
    if (stored) {
      Deno.env.set(spec.envVar, stored);
      continue;
    }

    step("Setup", spec.label);
    console.log(`Get one at ${spec.signupUrl}\n`);
    const key = prompt(spec.prompt)?.trim();
    if (!key) {
      throw new Error(`${spec.envVar} is required`);
    }

    config[spec.configKey] = key;
    Deno.env.set(spec.envVar, key);
    dirty = true;
  }

  if (dirty) {
    await writeConfig(config);
    step("Saved", CONFIG_FILE);
  }
}

/** Get the AssemblyAI API key, prompting if not set. */
export async function getApiKey(): Promise<string> {
  const config = await readConfig();
  if (config.assemblyai_api_key) {
    Deno.env.set("ASSEMBLYAI_API_KEY", config.assemblyai_api_key);
    return config.assemblyai_api_key;
  }

  step("Setup", "AssemblyAI API key required for speech-to-text");
  console.log("Get one at https://www.assemblyai.com/dashboard/signup\n");
  const key = prompt("Enter your ASSEMBLYAI_API_KEY:")?.trim();
  if (!key) {
    throw new Error("ASSEMBLYAI_API_KEY is required");
  }

  config.assemblyai_api_key = key;
  Deno.env.set("ASSEMBLYAI_API_KEY", key);
  await writeConfig(config);
  step("Saved", CONFIG_FILE);
  return key;
}

// -- Agent discovery ----------------------------------------------------------

export interface AgentManifestConfig {
  name?: string;
  instructions: string;
  greeting: string;
  voice: string;
  prompt?: string;
  builtinTools?: string[];
}

export interface AgentToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AgentEntry {
  slug: string;
  dir: string;
  entryPoint: string;
  env: Record<string, string>;
  clientEntry: string;
  transport: ("websocket" | "twilio")[];
  config?: AgentManifestConfig;
  toolSchemas?: AgentToolSchema[];
}

/** Imports that the workspace already resolves — not truly "external". */
const WORKSPACE_IMPORTS = new Set(["@aai/sdk", "@aai/ui", "zod"]);

/** Check if the agent has external imports beyond workspace packages. */
async function hasExternalImports(dir: string): Promise<boolean> {
  // Check deno.json imports
  try {
    const raw = JSON.parse(
      await Deno.readTextFile(join(dir, "deno.json")),
    );
    const imports = raw.imports ?? {};
    if (Object.keys(imports).some((k) => !WORKSPACE_IMPORTS.has(k))) {
      return true;
    }
  } catch { /* no deno.json */ }

  // Check package.json dependencies
  try {
    const raw = JSON.parse(
      await Deno.readTextFile(join(dir, "package.json")),
    );
    const deps = raw.dependencies ?? {};
    if (Object.keys(deps).length > 0) return true;
  } catch { /* no package.json */ }

  return false;
}

/** Import agent.ts and return the AgentDef, or null if external imports prevent it. */
async function importAgentDef(dir: string): Promise<AgentDef | null> {
  if (await hasExternalImports(dir)) return null;

  const entryPoint = join(dir, "agent.ts");
  const tmpPath = join(dir, `.aai-discover-${Date.now()}.js`);
  try {
    const source = await Deno.readTextFile(resolve(entryPoint));
    let js = await stripTypes(source);
    // Rewrite @aai/sdk imports to absolute paths so the tmp file resolves
    // correctly even when the agent dir is outside the workspace.
    const sdkPath = toFileUrl(resolve(AAI_ROOT, "sdk/mod.ts")).href;
    js = js.replace(
      /from\s*["']@aai\/sdk["']/g,
      `from "${sdkPath}"`,
    );
    await Deno.writeTextFile(tmpPath, js);
    const mod = await import(toFileUrl(tmpPath).href);
    return mod.default as AgentDef;
  } finally {
    await Deno.remove(tmpPath).catch(() => {});
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

  const config: AgentManifestConfig | undefined = def
    ? {
      name: def.name,
      instructions: def.instructions,
      greeting: def.greeting,
      voice: def.voice,
      prompt: def.prompt,
      builtinTools: def.builtinTools ? [...def.builtinTools] : undefined,
    }
    : undefined;

  const toolSchemas: AgentToolSchema[] | undefined = def
    ? agentToolsToSchemas(def.tools)
    : undefined;

  return {
    slug,
    dir,
    entryPoint: join(dir, "agent.ts"),
    env,
    clientEntry,
    transport,
    config,
    toolSchemas,
  };
}

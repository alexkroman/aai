// Copyright 2025 the AAI authors. MIT license.
import { promptSecret } from "@std/cli/prompt-secret";
import { parse as parseDotenv } from "@std/dotenv/parse";
import { exists } from "@std/fs/exists";
import * as log from "@std/log";
import { basename, join, resolve } from "@std/path";
import { z } from "zod";
/**
 * Converts a string into a URL-safe slug by lowercasing, replacing
 * non-alphanumeric runs with hyphens, and trimming leading/trailing hyphens.
 *
 * @param str The input string to slugify.
 * @returns A lowercase, hyphen-separated slug.
 */
export function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
import { step } from "./_output.ts";
import { AAI_ROOT } from "./_bundler.ts";

const CONFIG_DIR = join(
  Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? ".",
  ".config",
  "aai",
);
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

const AgentLinkSchema = z.object({
  namespace: z.string(),
  slug: z.string(),
  apiKey: z.string(),
});

type AgentLink = z.infer<typeof AgentLinkSchema>;

const CliConfigSchema = z.object({
  assemblyai_api_key: z.string().optional(),
  namespace: z.string().optional(),
  agents: z.record(z.string(), AgentLinkSchema).optional(),
});

type CliConfig = z.infer<typeof CliConfigSchema>;

async function readConfig(): Promise<CliConfig> {
  try {
    return CliConfigSchema.parse(
      JSON.parse(await Deno.readTextFile(CONFIG_FILE)),
    );
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
  // Restrict to owner-only read/write (like ~/.fly/config.yml)
  if (Deno.build.os !== "windows") {
    await Deno.chmod(CONFIG_FILE, 0o600);
  }
}

/**
 * Retrieves the AssemblyAI API key from the CLI config file. If not found,
 * interactively prompts the user to enter one and persists it.
 *
 * @returns The AssemblyAI API key.
 */
export async function getApiKey(): Promise<string> {
  const config = await readConfig();
  if (config.assemblyai_api_key) {
    Deno.env.set("ASSEMBLYAI_API_KEY", config.assemblyai_api_key);
    return config.assemblyai_api_key;
  }

  step("Setup", "AssemblyAI API key required for speech-to-text");
  log.info("Get one at https://www.assemblyai.com/dashboard/signup\n");
  let key: string | null = null;
  while (!key) {
    key = promptSecret("ASSEMBLYAI_API_KEY");
  }

  config.assemblyai_api_key = key;
  Deno.env.set("ASSEMBLYAI_API_KEY", key);
  await writeConfig(config);
  step("Saved", CONFIG_FILE);
  return key;
}

/**
 * Retrieves the user's agent namespace from the CLI config file. If not found,
 * interactively prompts the user to choose one and persists it.
 *
 * @returns The slugified namespace string.
 */
export async function getNamespace(): Promise<string> {
  const config = await readConfig();
  if (config.namespace) return config.namespace;

  log.info(
    "\nChoose a namespace for your agents.\n" +
      "Agents deploy to https://aai-agent.fly.dev/<namespace>/\n",
  );

  let slug = "";
  while (!slug) {
    const ns = prompt("Namespace");
    if (ns) slug = slugify(ns);
    if (!slug) log.info("Must contain alphanumeric characters");
  }

  config.namespace = slug;
  await writeConfig(config);
  step("Saved", `namespace: ${slug}`);
  return slug;
}

/**
 * Persists a namespace to the CLI config file.
 *
 * @param namespace The namespace string to save.
 */
export async function saveNamespace(namespace: string): Promise<void> {
  const config = await readConfig();
  config.namespace = namespace;
  await writeConfig(config);
  step("Saved", `namespace: ${namespace}`);
}

/**
 * Derives an agent slug from a directory path by slugifying the directory's
 * base name. Falls back to `"agent"` if the result is empty.
 *
 * @param dir Path to the agent directory.
 * @returns A URL-safe slug derived from the directory name.
 */
export function slugFromDir(dir: string): string {
  const dirName = basename(resolve(dir));
  const slug = slugify(dirName);
  return slug || "agent";
}

/**
 * Increments a numeric suffix on a name, or appends `-1` if none exists.
 * Used to generate unique slugs when a name collision is detected.
 *
 * @param name The name to increment (e.g. `"my-agent"` or `"my-agent-2"`).
 * @returns The name with an incremented suffix (e.g. `"my-agent-1"` or `"my-agent-3"`).
 */
export function incrementName(name: string): string {
  const match = name.match(/^(.+)-(\d+)$/);
  if (match) {
    return `${match[1]}-${Number(match[2]) + 1}`;
  }
  return `${name}-1`;
}

/**
 * Resolves a unique slug for an agent within a namespace. Returns the existing
 * slug if the directory is already linked, otherwise finds an unused slug by
 * incrementing a numeric suffix.
 *
 * @param dir Path to the agent directory.
 * @param namespace The user's namespace.
 * @param baseSlug The preferred slug to start from.
 * @returns A slug that is unique within the namespace.
 */
export async function resolveSlug(
  dir: string,
  namespace: string,
  baseSlug: string,
): Promise<string> {
  const config = await readConfig();
  const agents = config.agents ?? {};
  const resolvedDir = resolve(dir);

  const existing = agents[resolvedDir];
  if (existing && existing.namespace === namespace) {
    return existing.slug;
  }

  let slug = baseSlug;
  for (let i = 0; i < 100; i++) {
    const taken = Object.entries(agents).some(
      ([agentDir, link]) =>
        agentDir !== resolvedDir &&
        link.namespace === namespace &&
        link.slug === slug,
    );
    if (!taken) return slug;
    slug = incrementName(slug);
  }

  return slug;
}

/**
 * Persists the namespace/slug/apiKey association for an agent directory
 * in the CLI config file.
 *
 * @param dir Path to the agent directory.
 * @param link The agent link containing namespace, slug, and API key.
 */
export async function saveAgentLink(
  dir: string,
  link: AgentLink,
): Promise<void> {
  const config = await readConfig();
  if (!config.agents) config.agents = {};
  config.agents[resolve(dir)] = link;
  await writeConfig(config);
}

/** Discovered agent metadata extracted from an agent directory. */
export type AgentEntry = {
  /** URL-safe identifier derived from the directory name. */
  slug: string;
  /** Absolute path to the agent directory. */
  dir: string;
  /** Absolute path to the `agent.ts` entry point. */
  entryPoint: string;
  /** Environment variables loaded from `.env` (includes `ASSEMBLYAI_API_KEY`). */
  env: Record<string, string>;
  /** Absolute path to the client entry point (`client.ts` or `client.tsx`), or null if none. */
  clientEntry: string | null;
  /** Transport protocols the agent supports. */
  transport: readonly ("websocket" | "twilio")[];
};

/** Default production server URL for agent deployments. */
export const DEFAULT_SERVER = "https://aai-agent.fly.dev";

/**
 * Loads agent metadata from a directory by checking for `agent.ts`, reading
 * `.env` variables, resolving the client entry point, and ensuring an
 * AssemblyAI API key is available.
 *
 * @param dir Path to the directory containing `agent.ts`.
 * @returns The discovered agent entry, or `null` if no `agent.ts` exists.
 */
export async function loadAgent(dir: string): Promise<AgentEntry | null> {
  const hasAgentTs = await exists(join(dir, "agent.ts"));
  if (!hasAgentTs) return null;

  const slug = slugFromDir(dir);

  // Load all .env vars — the server extracts declared env from the worker at runtime
  const dotenvText = await Deno.readTextFile(join(dir, ".env")).catch(() => "");
  const env = parseDotenv(dotenvText);

  if (!env.ASSEMBLYAI_API_KEY && !Deno.env.get("ASSEMBLYAI_API_KEY")) {
    env.ASSEMBLYAI_API_KEY = await getApiKey();
  } else if (!env.ASSEMBLYAI_API_KEY) {
    env.ASSEMBLYAI_API_KEY = Deno.env.get("ASSEMBLYAI_API_KEY")!;
  }

  const clientEntry = await exists(join(dir, "client.ts"))
    ? join(dir, "client.ts")
    : await exists(join(dir, "client.tsx"))
    ? join(dir, "client.tsx")
    : null;

  return {
    slug,
    dir,
    entryPoint: join(dir, "agent.ts"),
    env,
    clientEntry,
    transport: ["websocket"],
  };
}

/**
 * Copies the canonical `cli/claude.md` into the agent directory as `CLAUDE.md`.
 * Creates the file if missing or updates it if the content has changed.
 *
 * @param targetDir Path to the agent directory.
 */
export async function ensureClaudeMd(targetDir: string): Promise<void> {
  const claudePath = join(targetDir, "CLAUDE.md");
  const srcClaude = join(AAI_ROOT, "cli", "claude.md");
  const srcContent = await Deno.readTextFile(srcClaude);
  let existing = "";
  try {
    existing = await Deno.readTextFile(claudePath);
  } catch { /* file doesn't exist */ }
  if (existing !== srcContent) {
    await Deno.copyFile(srcClaude, claudePath);
    step(
      existing ? "Updated" : "Wrote",
      "CLAUDE.md — aai agent API reference",
    );
  }
}

/**
 * Ensure package.json, tsconfig.json, and .npmrc exist in the agent directory
 * so editors can provide TypeScript autocomplete for @aai/sdk and @aai/ui.
 */
export async function ensureTypescriptSetup(
  targetDir: string,
): Promise<void> {
  const gitignorePath = join(targetDir, ".gitignore");
  if (!await exists(gitignorePath)) {
    await Deno.writeTextFile(gitignorePath, "node_modules/\n.env\n");
    step("Wrote", ".gitignore");
  }

  const npmrcPath = join(targetDir, ".npmrc");
  if (!await exists(npmrcPath)) {
    await Deno.writeTextFile(
      npmrcPath,
      "@jsr:registry=https://npm.jsr.io\n",
    );
    step("Wrote", ".npmrc");
  }

  const pkgPath = join(targetDir, "package.json");
  let needsInstall = false;
  if (!await exists(pkgPath)) {
    const dirName = basename(resolve(targetDir));
    const hasClient = await exists(join(targetDir, "client.ts")) ||
      await exists(join(targetDir, "client.tsx"));
    const pkg: Record<string, unknown> = {
      private: true,
      name: slugify(dirName) || "agent",
      scripts: {
        typecheck: "tsc --noEmit 2>&1 | grep -v 'node_modules/' || true",
      },
      dependencies: {
        "@jsr/aai__sdk": "*",
        ...(hasClient ? { "@jsr/aai__ui": "*" } : {}),
      },
      devDependencies: {
        typescript: "^5",
        ...(hasClient ? { preact: "^10" } : {}),
      },
    };
    await Deno.writeTextFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    step("Wrote", "package.json");
    needsInstall = true;
  }

  const tsconfigPath = join(targetDir, "tsconfig.json");
  if (!await exists(tsconfigPath)) {
    const hasClient = await exists(join(targetDir, "client.ts")) ||
      await exists(join(targetDir, "client.tsx"));
    const tsconfig: Record<string, unknown> = {
      compilerOptions: {
        strict: true,
        target: "ESNext",
        module: "ESNext",
        moduleResolution: "bundler",
        noEmit: true,
        skipLibCheck: true,
        paths: {
          "@aai/sdk": ["./node_modules/@jsr/aai__sdk/_dist/mod.d.ts"],
          ...(hasClient
            ? {
              "@aai/ui": ["./node_modules/@jsr/aai__ui/_dist/mod.d.ts"],
            }
            : {}),
        },
        ...(hasClient ? { jsx: "react-jsx", jsxImportSource: "preact" } : {}),
      },
      include: hasClient
        ? ["agent.ts", "client.ts", "client.tsx"]
        : ["agent.ts"],
      exclude: ["node_modules"],
    };
    await Deno.writeTextFile(
      tsconfigPath,
      JSON.stringify(tsconfig, null, 2) + "\n",
    );
    step("Wrote", "tsconfig.json");
  }

  if (!needsInstall && await exists(pkgPath)) {
    needsInstall = !await exists(join(targetDir, "node_modules"));
  }

  if (needsInstall) {
    try {
      step("Install", "npm dependencies...");
      const cmd = new Deno.Command("npm", {
        args: ["install"],
        cwd: targetDir,
        stdout: "null",
        stderr: "null",
      });
      const { code } = await cmd.output();
      if (code !== 0) {
        step("Skip", "npm install");
      }
    } catch {
      // npm not found — skip silently
    }
  }
}

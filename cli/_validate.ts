import { dirname, join, resolve } from "@std/path";
import { toFileUrl } from "@std/path/to-file-url";
import { exists } from "@std/fs/exists";
import type { AgentEntry } from "./_discover.ts";
import { stripTypes } from "./_bundler.ts";
import type { AgentDef, ToolContext, ToolDef } from "../aai/types.ts";

interface ValidationError {
  field: string;
  message: string;
}

export interface ToolTestResult {
  name: string;
  ok: boolean;
  error?: string;
  result?: unknown;
  skipped?: boolean;
}

export interface ValidationResult {
  errors: ValidationError[];
  name?: string;
  voice?: string;
  tools?: string[];
  builtinTools?: string[];
  toolTests?: ToolTestResult[];
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

/**
 * Validate an agent by dynamically importing agent.ts.
 * defineAgent() already validates fields -- we just check that
 * the module loads and produces a valid default export.
 *
 * Uses esbuild to strip types before importing because compiled
 * Deno binaries cannot dynamically import TypeScript files.
 *
 * Agents with external imports in deno.json skip validation here --
 * esbuild catches errors during bundling.
 */
export async function validateAgent(
  agent: AgentEntry,
): Promise<ValidationResult> {
  if (await hasExternalImports(agent.dir)) {
    return { errors: [] };
  }

  const errors: ValidationError[] = [];

  let mod: Record<string, unknown>;
  const tmpPath = join(
    dirname(resolve(agent.entryPoint)),
    `.aai-validate-${Date.now()}.js`,
  );
  try {
    const source = await Deno.readTextFile(resolve(agent.entryPoint));
    const js = await stripTypes(source);
    await Deno.writeTextFile(tmpPath, js);
    mod = await import(toFileUrl(tmpPath).href);
  } catch (cause) {
    errors.push({
      field: "agent.ts",
      message: `failed to import: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    });
    return { errors };
  } finally {
    await Deno.remove(tmpPath).catch(() => {});
  }

  if (!mod.default) {
    errors.push({
      field: "agent.ts",
      message:
        "missing default export -- use `export default defineAgent({...})`",
    });
    return { errors };
  }

  const def = mod.default as Record<string, unknown>;

  const name = typeof def.name === "string" ? def.name : undefined;
  if (!name) {
    errors.push({ field: "name", message: "must be a non-empty string" });
  }

  const tools = def.tools && typeof def.tools === "object"
    ? Object.keys(def.tools as Record<string, unknown>)
    : [];

  const voice = typeof def.voice === "string" ? def.voice : "luna";

  const builtinTools = Array.isArray(def.builtinTools)
    ? (def.builtinTools as string[])
    : [];

  const toolTests = await testTools(
    def as unknown as AgentDef,
    agent,
  );

  return { errors, name, voice, tools, builtinTools, toolTests };
}

/** Test each custom tool by invoking execute() with minimal args. */
async function testTools(
  def: AgentDef,
  agent: AgentEntry,
): Promise<ToolTestResult[]> {
  if (!def.tools || Object.keys(def.tools).length === 0) return [];

  const ctx: ToolContext = { sessionId: "test", env: agent.env };
  const results: ToolTestResult[] = [];

  for (const [name, tool] of Object.entries(def.tools)) {
    results.push(await testOneTool(name, tool, ctx));
  }
  return results;
}

async function testOneTool(
  name: string,
  tool: ToolDef,
  ctx: ToolContext,
): Promise<ToolTestResult> {
  // Check that description exists
  if (!tool.description) {
    return { name, ok: false, error: "missing description" };
  }

  // Check that execute is a function
  if (typeof tool.execute !== "function") {
    return { name, ok: false, error: "execute is not a function" };
  }

  // If tool has required params, validate schema but skip execution
  if (tool.parameters) {
    const parseResult = tool.parameters.safeParse({});
    if (!parseResult.success) {
      return { name, ok: true, skipped: true };
    }
    // Schema accepts empty object — we can test it
    try {
      const result = await tool.execute(parseResult.data, ctx);
      return { name, ok: true, result };
    } catch (err) {
      return {
        name,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // No params — call directly
  try {
    const result = await tool.execute({}, ctx);
    return { name, ok: true, result };
  } catch (err) {
    return {
      name,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

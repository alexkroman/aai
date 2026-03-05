import { resolve } from "@std/path";
import { toFileUrl } from "@std/path/to-file-url";
import type { AgentEntry } from "./_discover.ts";

interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  errors: ValidationError[];
  name?: string;
  tools?: string[];
  builtinTools?: string[];
}

/**
 * Validate an agent definition by dynamically importing agent.ts
 * and checking its structure before bundling/deploying.
 */
export async function validateAgent(
  agent: AgentEntry,
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];

  // Import the agent module
  let mod: Record<string, unknown>;
  try {
    // Set up globals that agent.ts expects (defineAgent, z, fetchJSON)
    const { defineAgent } = await import("../server/agent.ts");
    const { fetchJSON } = await import("../server/fetch_json.ts");
    const { z } = await import("zod");
    Object.assign(globalThis, { defineAgent, fetchJSON, z });

    mod = await import(toFileUrl(resolve(agent.entryPoint)).href);
  } catch (err) {
    errors.push({
      field: "agent.ts",
      message: `failed to import: ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
    return { errors };
  }

  // Check default export exists
  if (!mod.default) {
    errors.push({
      field: "agent.ts",
      message:
        "missing default export — use `export default defineAgent({...})`",
    });
    return { errors };
  }

  const def = mod.default as Record<string, unknown>;

  // Check it looks like an AgentDef
  if (typeof def.name !== "string" || !def.name) {
    errors.push({
      field: "name",
      message: "must be a non-empty string",
    });
  }

  if (typeof def.instructions !== "string") {
    errors.push({
      field: "instructions",
      message: "must be a string",
    });
  }

  if (typeof def.voice !== "string") {
    errors.push({
      field: "voice",
      message: "must be a string",
    });
  }

  // Validate tools (defineAgent already does this, but if someone bypasses it)
  const toolNames: string[] = [];
  if (def.tools && typeof def.tools === "object") {
    for (
      const [name, tool] of Object.entries(def.tools as Record<string, unknown>)
    ) {
      const t = tool as Record<string, unknown>;
      if (!t.description || typeof t.description !== "string") {
        errors.push({
          field: `tools.${name}.description`,
          message: "must be a non-empty string",
        });
      }
      if (t.parameters == null) {
        errors.push({
          field: `tools.${name}.parameters`,
          message: "is required — use z.object({}) or a JSON Schema object",
        });
      }
      if (typeof t.execute !== "function") {
        errors.push({
          field: `tools.${name}.execute`,
          message: "must be a function",
        });
      }
      toolNames.push(name);
    }
  }

  const builtinTools = Array.isArray(def.builtinTools)
    ? (def.builtinTools as string[])
    : [];

  return {
    errors,
    name: typeof def.name === "string" ? def.name : undefined,
    tools: toolNames,
    builtinTools,
  };
}

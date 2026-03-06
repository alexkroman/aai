import { join } from "@std/path";
import { step } from "./_output.ts";

const TYPES_TEMPLATE = Deno.readTextFileSync(
  new URL("./types.template", import.meta.url),
);

function buildDenoJson(): string {
  const config = {
    compilerOptions: {
      jsx: "react-jsx",
      jsxImportSource: "preact",
    },
  };
  return JSON.stringify(config, null, 2) + "\n";
}

/** Write types.d.ts (and deno.json if missing) to the given directory. */
export async function generateTypes(dir: string): Promise<string> {
  const dest = join(dir, "types.d.ts");
  await Deno.writeTextFile(dest, TYPES_TEMPLATE);

  const denoJsonPath = join(dir, "deno.json");
  const tsconfigPath = join(dir, "tsconfig.json");
  let hasConfig = false;
  try {
    await Deno.stat(denoJsonPath);
    hasConfig = true;
  } catch { /* missing */ }
  if (!hasConfig) {
    try {
      await Deno.stat(tsconfigPath);
      hasConfig = true;
    } catch { /* missing */ }
  }
  if (!hasConfig) {
    await Deno.writeTextFile(denoJsonPath, buildDenoJson());
  }

  return dest;
}

/** CLI handler for `aai types`. */
export async function runTypes(dir: string): Promise<void> {
  const dest = await generateTypes(dir);
  step("Generated", dest);
}

import { z } from "zod";
import type { ToolContext, ToolDef } from "./types.ts";

export type ActionDef = {
  schema?: z.ZodObject<z.ZodRawShape>;
  execute: (
    args: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<unknown> | unknown;
};

/**
 * Define a typed multiTool action. Infers execute args from the Zod schema
 * so you can destructure without `as string` casts.
 */
export function action<P extends z.ZodObject<z.ZodRawShape>>(def: {
  schema: P;
  execute: (
    args: z.infer<P>,
    ctx: ToolContext,
  ) => Promise<unknown> | unknown;
}): ActionDef {
  return def as unknown as ActionDef;
}

export function multiTool(opts: {
  description: string;
  actions: Record<string, ActionDef>;
}): ToolDef {
  const actionNames = Object.keys(opts.actions);
  const actionEnum = z.enum(actionNames as [string, ...string[]]).describe(
    "The action to perform",
  );

  // Merge all action schemas into one: { action, ...allOptionalFields }
  const allProps: Record<string, z.ZodTypeAny> = { action: actionEnum };
  for (const def of Object.values(opts.actions)) {
    if (def.schema) {
      for (const [key, val] of Object.entries(def.schema.shape)) {
        if (!(key in allProps)) {
          allProps[key] = (val as z.ZodTypeAny).optional();
        }
      }
    }
  }

  return {
    description: opts.description,
    parameters: z.object(allProps),
    execute: (args, ctx) => {
      const action = args.action as string;
      const handler = opts.actions[action];
      if (!handler) return { error: `Unknown action: ${action}` };
      if (handler.schema) {
        const parsed = handler.schema.safeParse(args);
        if (!parsed.success) return { error: parsed.error.message };
        return handler.execute(parsed.data as Record<string, unknown>, ctx);
      }
      return handler.execute(args, ctx);
    },
  };
}

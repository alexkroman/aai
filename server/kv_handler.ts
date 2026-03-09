import { z } from "zod";
import type { KvStore } from "./kv.ts";
import { verifyScopeToken } from "./kv.ts";

const KvRequestSchema = z.object({
  op: z.enum(["get", "set", "del", "keys"]),
  key: z.string().optional(),
  value: z.string().optional(),
  ttl: z.number().optional(),
  pattern: z.string().optional(),
});

export async function handleKv(
  req: Request,
  ctx: { kvStore: KvStore },
): Promise<Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return Response.json(
      { error: "Missing Authorization header" },
      { status: 401 },
    );
  }

  const scopeToken = authHeader.slice("Bearer ".length);
  const scope = await verifyScopeToken(scopeToken);
  if (!scope) {
    return Response.json(
      { error: "Invalid or tampered scope token" },
      { status: 403 },
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = KvRequestSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: `Invalid KV request: ${parsed.error.message}` },
      { status: 400 },
    );
  }

  const { op, key, value, ttl, pattern } = parsed.data;

  try {
    switch (op) {
      case "get": {
        if (!key) {
          return Response.json(
            { error: "Missing key for get operation" },
            { status: 400 },
          );
        }
        const result = await ctx.kvStore.get(scope, key);
        return Response.json({ result });
      }
      case "set": {
        if (!key) {
          return Response.json(
            { error: "Missing key for set operation" },
            { status: 400 },
          );
        }
        if (value === undefined) {
          return Response.json(
            { error: "Missing value for set operation" },
            { status: 400 },
          );
        }
        await ctx.kvStore.set(scope, key, value, ttl);
        return Response.json({ result: "OK" });
      }
      case "del": {
        if (!key) {
          return Response.json(
            { error: "Missing key for del operation" },
            { status: 400 },
          );
        }
        await ctx.kvStore.del(scope, key);
        return Response.json({ result: "OK" });
      }
      case "keys": {
        const result = await ctx.kvStore.keys(scope, pattern);
        return Response.json({ result });
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("KV operation failed", {
      op,
      slug: scope.slug,
      error: message,
    });
    return Response.json(
      { error: `KV operation failed: ${message}` },
      { status: 500 },
    );
  }
}

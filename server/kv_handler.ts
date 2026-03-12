// Copyright 2025 the AAI authors. MIT license.
import * as log from "@std/log";
import type { Context } from "hono";
import type { HonoEnv } from "./hono_env.ts";
import { jsonValidator } from "./_validation.ts";
import { type KvHttpRequest, KvHttpRequestSchema } from "./_schemas.ts";

/** Hono middleware that validates the KV request body against {@linkcode KvHttpRequestSchema}. */
export const validateKvRequest = jsonValidator(
  KvHttpRequestSchema,
  "Invalid request",
);

/**
 * Hono handler for the KV operations endpoint (`POST /:slug/kv`).
 *
 * Dispatches `get`, `set`, `del`, `keys`, and `list` operations to the
 * KV store, scoped to the requesting agent.
 *
 * @param c - The Hono request context with a validated {@linkcode KvHttpRequest}.
 * @returns A JSON response with the operation result or a 500 error.
 */
export async function handleKv(
  c: Context<HonoEnv, string, { out: { json: KvHttpRequest } }>,
) {
  const { scope, kvStore } = c.var;
  const msg = c.req.valid("json");

  try {
    switch (msg.op) {
      case "get":
        return c.json({ result: await kvStore.get(scope, msg.key) });
      case "set":
        await kvStore.set(scope, msg.key, msg.value, msg.ttl);
        return c.json({ result: "OK" });
      case "del":
        await kvStore.del(scope, msg.key);
        return c.json({ result: "OK" });
      case "keys":
        return c.json({ result: await kvStore.keys(scope, msg.pattern) });
      case "list":
        return c.json({
          result: await kvStore.list(scope, msg.prefix, {
            ...(msg.limit !== undefined && { limit: msg.limit }),
            ...(msg.reverse !== undefined && { reverse: msg.reverse }),
          }),
        });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("KV operation failed", {
      op: msg.op,
      slug: scope.slug,
      error: message,
    });
    return c.json({ error: `KV operation failed: ${message}` }, 500);
  }
}

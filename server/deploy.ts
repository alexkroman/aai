// Copyright 2025 the AAI authors. MIT license.
import * as log from "@std/log";
import type { Context } from "hono";
import { loadPlatformConfig } from "./config.ts";
import type { DeployBody } from "@aai/sdk/types";
import { normalizeTransport } from "@aai/sdk/types";
import { DeployBodySchema } from "./_schemas.ts";
import type { AgentSlot } from "./worker_pool.ts";
import type { HonoEnv } from "./hono_env.ts";
import { jsonValidator } from "./_validation.ts";

export { hashApiKey } from "./auth.ts";

/** Hono middleware that validates the deploy request body against {@linkcode DeployBodySchema}. */
export const validateDeployBody = jsonValidator(
  DeployBodySchema,
  "Invalid deploy body",
);

/**
 * Hono handler for the agent deploy endpoint (`POST /:slug/deploy`).
 *
 * Validates platform config, terminates any existing worker for the slug,
 * persists the new bundle to the store, and registers the agent slot.
 *
 * @param c - The Hono request context with a validated {@linkcode DeployBody}.
 * @returns A JSON response indicating success or a 400 error for invalid config.
 */
export async function handleDeploy(
  c: Context<HonoEnv, string, { out: { json: DeployBody } }>,
) {
  const { slug, accountId, slots, store } = c.var;
  const body = c.req.valid("json");

  try {
    loadPlatformConfig(body.env);
  } catch (err: unknown) {
    return c.json(
      {
        error: `Invalid platform config: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      400,
    );
  }

  const existing = slots.get(slug);
  if (existing?.worker) {
    log.info("Replacing existing deploy", { slug });
    existing.worker.handle.terminate();
    delete existing.worker;
    delete existing.initializing;
  }

  const transport = normalizeTransport(body.transport);

  await store.putAgent({
    slug,
    env: body.env,
    transport,
    worker: body.worker,
    client: body.client,
    account_id: accountId,
  });

  const slot: AgentSlot = {
    slug,
    env: body.env,
    transport,
    accountId,
  };
  slots.set(slug, slot);

  log.info("Deploy received", { slug, transport });

  return c.json({ ok: true, message: `Deployed ${slug}` });
}

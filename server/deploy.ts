// Copyright 2025 the AAI authors. MIT license.
import * as log from "@std/log";
import { json, type RouteContext } from "./context.ts";
import { loadPlatformConfig } from "./config.ts";
import type { DeployBody } from "@aai/sdk/types";
import { HttpError } from "./context.ts";
import { DeployBodySchema } from "./_schemas.ts";
import type { AgentSlot } from "./worker_pool.ts";

export { hashApiKey } from "./auth.ts";

/**
 * Handler for the agent deploy endpoint (`POST /:slug/deploy`).
 *
 * Validates platform config, terminates any existing worker for the slug,
 * persists the new bundle to the store, and registers the agent slot.
 */
export async function handleDeploy(
  ctx: RouteContext,
  opts: { slug: string; accountId: string },
): Promise<Response> {
  const { state } = ctx;
  const { slug, accountId } = opts;
  let body: DeployBody;
  try {
    body = DeployBodySchema.parse(await ctx.req.json());
  } catch {
    throw new HttpError(400, "Invalid deploy body");
  }

  try {
    loadPlatformConfig(body.env);
  } catch (err: unknown) {
    return json(
      {
        error: `Invalid platform config: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 400 },
    );
  }

  const existing = state.slots.get(slug);
  if (existing?.worker) {
    log.info("Replacing existing deploy", { slug });
    existing.worker.handle.terminate();
    delete existing.worker;
    delete existing.initializing;
  }

  const transport = body.transport ?? ["websocket"];

  await state.store.putAgent({
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
  state.slots.set(slug, slot);

  log.info("Deploy received", { slug, transport });

  return json({ ok: true, message: `Deployed ${slug}` });
}

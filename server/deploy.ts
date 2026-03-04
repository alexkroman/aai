import { Hono } from "@hono/hono";
import { HTTPException } from "@hono/hono/http-exception";
import { z } from "zod";
import { loadPlatformConfig } from "./config.ts";
import { getLogger } from "./logger.ts";
import type { AgentSlot } from "./worker_pool.ts";
import type { BundleStore } from "./bundle_store_tigris.ts";

const DeployBodySchema = z.object({
  slug: z.string().min(1),
  env: z.record(z.string(), z.string()),
  worker: z.string().min(1),
  client: z.string().min(1),
  transport: z.union([
    z.enum(["websocket", "twilio"]),
    z.array(z.enum(["websocket", "twilio"])),
  ]).optional(),
});

const log = getLogger("deploy");

export function createDeployRoute(ctx: {
  slots: Map<string, AgentSlot>;
  store: BundleStore;
}): Hono {
  const { slots, store } = ctx;
  const deploy = new Hono();

  deploy.post("/deploy", async (c) => {
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      throw new HTTPException(400, { message: "Invalid JSON body" });
    }

    const parsed = DeployBodySchema.safeParse(json);
    if (!parsed.success) {
      throw new HTTPException(400, {
        message: `Invalid deploy body: ${parsed.error.message}`,
      });
    }
    const body = parsed.data;

    try {
      loadPlatformConfig(body.env);
    } catch (err: unknown) {
      throw new HTTPException(400, {
        message: `Invalid platform config: ${(err as Error).message}`,
      });
    }

    const existing = slots.get(body.slug);
    if (existing?.live) {
      log.info("Replacing existing deploy", { slug: body.slug });
      existing.live.worker.terminate();
      existing.live = undefined;
      existing.initializing = undefined;
    }

    const transport: ("websocket" | "twilio")[] = body.transport === undefined
      ? ["websocket"]
      : typeof body.transport === "string"
      ? [body.transport]
      : body.transport;

    await store.putAgent({
      slug: body.slug,
      env: body.env,
      transport,
      worker: body.worker,
      client: body.client,
    });

    const slot: AgentSlot = {
      slug: body.slug,
      env: body.env,
      transport,
      activeSessions: 0,
    };
    slots.set(body.slug, slot);

    log.info("Deploy received", { slug: body.slug, transport });

    return c.json({ ok: true, message: `Deployed ${body.slug}` });
  });

  return deploy;
}

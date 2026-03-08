import type { Context } from "hono";
import { renderAgentPage } from "./html.ts";
import { handleSessionWebSocket } from "./ws_handler.ts";
import { createSession, type Session } from "./session.ts";
import {
  type AgentSlot,
  createToolExecutor,
  registerSlot,
  trackSessionClose,
  trackSessionOpen,
} from "./worker_pool.ts";
import { loadPlatformConfig } from "./config.ts";
import { getBuiltinToolSchemas } from "./builtin_tools.ts";
import type { ServerContext } from "./types.ts";

async function discoverSlot(
  slug: string,
  ctx: ServerContext,
): Promise<AgentSlot | null> {
  const existing = ctx.slots.get(slug);
  if (existing) return existing;

  const manifest = await ctx.store.getManifest(slug);
  if (!manifest) return null;

  if (registerSlot(ctx.slots, manifest)) {
    console.info("Lazy-discovered agent from store", { slug });
  }
  return ctx.slots.get(slug) ?? null;
}

async function resolveSlot(
  slug: string,
  ctx: ServerContext,
): Promise<AgentSlot | null> {
  const slot = await discoverSlot(slug, ctx);
  if (!slot?.transport.includes("websocket")) return null;
  return slot;
}

export async function handleAgentHealth(
  c: Context,
  slug: string,
  ctx: ServerContext,
): Promise<Response> {
  const slot = await resolveSlot(slug, ctx);
  if (!slot) return c.json({ error: "Not found", slug }, 404);
  return c.json({ status: "ok", slug, name: slot.name ?? slug });
}

export async function handleAgentPage(
  c: Context,
  slug: string,
  ctx: ServerContext,
): Promise<Response> {
  const slot = await resolveSlot(slug, ctx);
  if (!slot) return c.json({ error: "Not found" }, 404);
  const name = slot.name ?? slug;
  return c.html(renderAgentPage(name, `/${slug}`));
}

export async function handleAgentRedirect(
  c: Context,
  slug: string,
  ctx: ServerContext,
): Promise<Response> {
  const slot = await resolveSlot(slug, ctx);
  if (!slot) return c.json({ error: "Not found" }, 404);
  return c.redirect(`/${slug}/`, 301);
}

export async function handleWebSocket(
  c: Context,
  slug: string,
  ctx: ServerContext,
): Promise<Response> {
  const slot = await resolveSlot(slug, ctx);
  if (!slot) return c.json({ error: "Not found" }, 404);

  const req = c.req.raw;
  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return c.json({ error: "Expected WebSocket upgrade" }, 400);
  }

  const config = slot.config!;
  const builtinTools = getBuiltinToolSchemas(config.builtinTools ?? []);
  const toolSchemas = [...(slot.toolSchemas ?? []), ...builtinTools];
  const { executeTool, getWorkerApi } = createToolExecutor(slot, ctx.store);

  const resume = new URL(req.url).searchParams.has("resume");
  const { socket, response } = Deno.upgradeWebSocket(req);
  handleSessionWebSocket(socket, ctx.sessions as Map<string, Session>, {
    createSession: (sessionId, ws) =>
      createSession({
        id: sessionId,
        transport: ws,
        agentConfig: config,
        toolSchemas,
        platformConfig: loadPlatformConfig(slot.env),
        executeTool,
        getWorkerApi,
        env: slot.env,
        skipGreeting: resume,
      }),
    logContext: { slug },
    onOpen: () => trackSessionOpen(slot),
    onClose: () => trackSessionClose(slot),
  });
  return response;
}

export async function handleStaticFile(
  c: Context,
  slug: string,
  file: string,
  ctx: ServerContext,
): Promise<Response> {
  const slot = await resolveSlot(slug, ctx);
  if (!slot) return c.json({ error: "Not found" }, 404);

  const STATIC_FILES: Record<
    string,
    { key: "client" | "client_map"; ct: string }
  > = {
    "client.js": { key: "client", ct: "application/javascript" },
    "client.js.map": { key: "client_map", ct: "application/json" },
  };

  const spec = STATIC_FILES[file];
  if (!spec) return c.json({ error: "Not found" }, 404);

  const content = await ctx.store.getFile(slug, spec.key);
  if (!content) return c.json({ error: "Not found" }, 404);
  return c.body(content, {
    headers: { "Content-Type": spec.ct, "Cache-Control": "no-cache" },
  });
}

import { loadPlatformConfig } from "./config.ts";
import { getBuiltinToolSchemas } from "./builtin_tools.ts";
import { renderAgentPage } from "./html.ts";
import { handleSessionWebSocket } from "./ws_handler.ts";
import { createSession, type Session } from "./session.ts";
import {
  type AgentSlot,
  createLazyToolExecutor,
  createLazyWorkerApi,
  registerSlot,
  trackSessionClose,
  trackSessionOpen,
} from "./worker_pool.ts";
import type { BundleStore } from "./bundle_store_tigris.ts";

async function discoverSlot(
  slug: string,
  slots: Map<string, AgentSlot>,
  store: BundleStore,
): Promise<AgentSlot | null> {
  const existing = slots.get(slug);
  if (existing) return existing;

  const manifest = await store.getManifest(slug);
  if (!manifest) return null;

  if (registerSlot(slots, manifest)) {
    console.info("Lazy-discovered agent from store", { slug });
  }
  return slots.get(slug) ?? null;
}

export interface WebSocketContext {
  slots: Map<string, AgentSlot>;
  sessions: Map<string, Session>;
  store: BundleStore;
}

async function resolveSlot(
  slug: string,
  ctx: WebSocketContext,
): Promise<AgentSlot | null> {
  const slot = await discoverSlot(slug, ctx.slots, ctx.store);
  if (!slot?.transport.includes("websocket")) return null;
  return slot;
}

export async function handleAgentHealth(
  req: Request,
  slug: string,
  ctx: WebSocketContext,
): Promise<Response> {
  void req;
  const slot = await resolveSlot(slug, ctx);
  if (!slot) {
    return Response.json({ error: "Not found", slug }, { status: 404 });
  }
  return Response.json({
    status: "ok",
    slug,
    name: slot.name ?? slug,
  });
}

export async function handleAgentPage(
  req: Request,
  slug: string,
  ctx: WebSocketContext,
): Promise<Response> {
  void req;
  const slot = await resolveSlot(slug, ctx);
  if (!slot) return Response.json({ error: "Not found" }, { status: 404 });
  const name = slot.name ?? slug;
  return new Response(renderAgentPage(name, `/${slug}`), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function handleAgentRedirect(
  req: Request,
  slug: string,
  ctx: WebSocketContext,
): Promise<Response> {
  void req;
  const slot = await resolveSlot(slug, ctx);
  if (!slot) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.redirect(new URL(`/${slug}/`, req.url).href, 301);
}

export async function handleWebSocket(
  req: Request,
  slug: string,
  ctx: WebSocketContext,
): Promise<Response> {
  const slot = await resolveSlot(slug, ctx);
  if (!slot) return Response.json({ error: "Not found" }, { status: 404 });
  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return Response.json(
      { error: "Expected WebSocket upgrade" },
      { status: 400 },
    );
  }

  const config = slot.config!;
  const customTools = slot.toolSchemas ?? [];
  const builtinTools = getBuiltinToolSchemas(config.builtinTools ?? []);
  const toolSchemas = [...customTools, ...builtinTools];
  const getWorkerCode = (s: string) => ctx.store.getFile(s, "worker");
  const getWorkerApi = customTools.length > 0
    ? createLazyWorkerApi(slot, getWorkerCode)
    : undefined;

  const resume = new URL(req.url).searchParams.has("resume");
  const { socket, response } = Deno.upgradeWebSocket(req);
  handleSessionWebSocket(socket, ctx.sessions, {
    createSession: (sessionId, ws) =>
      createSession({
        id: sessionId,
        transport: ws,
        agentConfig: config,
        toolSchemas,
        platformConfig: loadPlatformConfig(slot.env),
        executeTool: getWorkerApi
          ? createLazyToolExecutor(getWorkerApi)
          : (_name, _args) => Promise.resolve("Error: No custom tools"),
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
  req: Request,
  slug: string,
  file: string,
  ctx: WebSocketContext,
): Promise<Response> {
  void req;
  const slot = await resolveSlot(slug, ctx);
  if (!slot) return Response.json({ error: "Not found" }, { status: 404 });

  const STATIC_FILES: Record<
    string,
    { key: "client" | "client_map"; ct: string }
  > = {
    "client.js": { key: "client", ct: "application/javascript" },
    "client.js.map": { key: "client_map", ct: "application/json" },
  };

  const spec = STATIC_FILES[file];
  if (!spec) return Response.json({ error: "Not found" }, { status: 404 });

  const content = await ctx.store.getFile(slug, spec.key);
  if (!content) return Response.json({ error: "Not found" }, { status: 404 });
  return new Response(content, {
    headers: { "Content-Type": spec.ct, "Cache-Control": "no-cache" },
  });
}

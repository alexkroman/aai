// Copyright 2025 the AAI authors. MIT license.
import * as log from "@std/log";
import { html, HttpError, json, type RouteContext } from "./context.ts";
import { eTag, ifNoneMatch } from "@std/http/etag";
import { renderAgentPage, renderNoClientPage } from "./html.ts";
import { wireSessionSocket } from "./ws_handler.ts";
import { createSession } from "./session.ts";
import { type AgentSlot, prepareSession, registerSlot } from "./worker_pool.ts";
import type { BundleStore } from "./bundle_store_tigris.ts";

export const _internals = { prepareSession };

/**
 * Discovers an agent slot, lazily loading it from the bundle store if needed.
 *
 * If the slot is already registered in memory, returns it immediately.
 * Otherwise, checks the bundle store for a manifest and registers the slot.
 */
type SlotLookup = { slots: Map<string, AgentSlot>; store: BundleStore };

export async function discoverSlot(
  slug: string,
  opts: SlotLookup,
): Promise<AgentSlot | null> {
  const existing = opts.slots.get(slug);
  if (existing) return existing;

  const manifest = await opts.store.getManifest(slug);
  if (!manifest) return null;

  if (registerSlot(opts.slots, manifest)) {
    log.info("Lazy-discovered agent from store", { slug });
  }
  return opts.slots.get(slug) ?? null;
}

/**
 * Resolves an agent slot that supports the WebSocket transport.
 */
export async function resolveSlot(
  slug: string,
  opts: SlotLookup,
): Promise<AgentSlot | null> {
  const slot = await discoverSlot(slug, opts);
  if (!slot?.transport.includes("websocket")) return null;
  return slot;
}

async function requireSlot(
  slug: string,
  opts: SlotLookup,
): Promise<AgentSlot> {
  const slot = await resolveSlot(slug, opts);
  if (!slot) throw new HttpError(404, `Not found: ${slug}`);
  return slot;
}

/** Handler for the agent health check endpoint (`GET /:slug/health`). */
export async function handleAgentHealth(
  ctx: RouteContext,
  slug: string,
): Promise<Response> {
  const slot = await requireSlot(slug, ctx.state);
  return json({ status: "ok", slug, name: slot.name ?? slug });
}

/** Handler for the agent landing page (`GET /:slug`). */
export async function handleAgentPage(
  ctx: RouteContext,
  slug: string,
): Promise<Response> {
  const slot = await requireSlot(slug, ctx.state);
  const hasClient = await ctx.state.store.getFile(slug, "client") !== null;
  if (!hasClient) {
    return html(renderNoClientPage(slot.name ?? slug));
  }
  return html(renderAgentPage(slot.name ?? slug, `/${slug}`));
}

/**
 * Handler that upgrades an HTTP request to a WebSocket session.
 *
 * Prepares the agent worker and session, then delegates to
 * {@linkcode wireSessionSocket} for WebSocket lifecycle management.
 */
export async function handleWebSocket(
  ctx: RouteContext,
  slug: string,
): Promise<Response> {
  const slot = await requireSlot(slug, ctx.state);
  const setup = await _internals.prepareSession(slot, {
    slug,
    store: ctx.state.store,
    kvStore: ctx.state.kvStore,
  });
  const resume = new URL(ctx.req.url).searchParams.has("resume");

  const { socket, response } = Deno.upgradeWebSocket(ctx.req);

  wireSessionSocket(socket, {
    sessions: ctx.state.sessions,
    createSession: (sessionId, transport) =>
      createSession({
        id: sessionId,
        agent: slug,
        transport,
        ...setup,
        skipGreeting: resume,
      }),
    logContext: { slug },
  });

  return response;
}

/**
 * Handler that serves static agent files (`client.js`, `client.js.map`).
 */
export async function handleStaticFile(
  ctx: RouteContext,
  opts: { slug: string; file: string },
): Promise<Response> {
  const { slug, file } = opts;
  await requireSlot(slug, ctx.state);

  const STATIC_FILES: Record<
    string,
    { key: "client" | "client_map"; ct: string }
  > = {
    "client.js": { key: "client", ct: "application/javascript" },
    "client.js.map": { key: "client_map", ct: "application/json" },
  };

  const spec = STATIC_FILES[file];
  if (!spec) throw new HttpError(404, "Not found");

  const content = await ctx.state.store.getFile(slug, spec.key);
  if (!content) throw new HttpError(404, "Not found");

  const data = typeof content === "string"
    ? new TextEncoder().encode(content)
    : new Uint8Array(content as ArrayBuffer);
  const tag = await eTag(data);

  // Conditional request support
  if (tag && !ifNoneMatch(ctx.req.headers.get("If-None-Match"), tag)) {
    return new Response(null, {
      status: 304,
      headers: { ...(tag ? { ETag: tag } : {}) },
    });
  }

  return new Response(content, {
    headers: {
      "Content-Type": spec.ct,
      "Cache-Control": "no-cache",
      ...(tag ? { ETag: tag } : {}),
    },
  });
}

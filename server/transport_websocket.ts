// Copyright 2025 the AAI authors. MIT license.
import * as log from "@std/log";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { renderAgentPage } from "./html.ts";
import { createSessionWSEvents } from "./ws_handler.ts";
import { createSession } from "./session.ts";
import { type AgentSlot, prepareSession, registerSlot } from "./worker_pool.ts";
import type { HonoEnv } from "./hono_env.ts";
import type { BundleStore } from "./bundle_store_tigris.ts";
import { upgradeWebSocket } from "hono/deno";

export const _internals = { prepareSession };

/**
 * Discovers an agent slot, lazily loading it from the bundle store if needed.
 *
 * If the slot is already registered in memory, returns it immediately.
 * Otherwise, checks the bundle store for a manifest and registers the slot.
 *
 * @param slug - The agent slug to look up.
 * @param slots - The in-memory map of active agent slots.
 * @param store - Bundle store to check for agent manifests.
 * @returns The agent slot, or `null` if the agent does not exist.
 */
export async function discoverSlot(
  slug: string,
  slots: Map<string, AgentSlot>,
  store: BundleStore,
): Promise<AgentSlot | null> {
  const existing = slots.get(slug);
  if (existing) return existing;

  const manifest = await store.getManifest(slug);
  if (!manifest) return null;

  if (registerSlot(slots, manifest)) {
    log.info("Lazy-discovered agent from store", { slug });
  }
  return slots.get(slug) ?? null;
}

/**
 * Resolves an agent slot that supports the WebSocket transport.
 *
 * @param slug - The agent slug to look up.
 * @param slots - The in-memory map of active agent slots.
 * @param store - Bundle store to check for agent manifests.
 * @returns The agent slot if it exists and supports WebSocket, otherwise `null`.
 */
export async function resolveSlot(
  slug: string,
  slots: Map<string, AgentSlot>,
  store: BundleStore,
): Promise<AgentSlot | null> {
  const slot = await discoverSlot(slug, slots, store);
  if (!slot?.transport.includes("websocket")) return null;
  return slot;
}

async function requireSlot(
  slug: string,
  slots: Map<string, AgentSlot>,
  store: BundleStore,
): Promise<AgentSlot> {
  const slot = await resolveSlot(slug, slots, store);
  if (!slot) throw new HTTPException(404, { message: `Not found: ${slug}` });
  return slot;
}

/**
 * Hono handler for the agent health check endpoint (`GET /:slug/health`).
 *
 * @param c - The Hono request context.
 * @returns A JSON response with `{ status: "ok", slug, name }`.
 * @throws {HTTPException} 404 if the agent is not found or doesn't support WebSocket.
 */
export async function handleAgentHealth(c: Context<HonoEnv>) {
  const { slug, slots, store } = c.var;
  const slot = await requireSlot(slug, slots, store);
  return c.json({ status: "ok", slug, name: slot.name ?? slug });
}

/**
 * Hono handler for the agent landing page (`GET /:slug`).
 *
 * @param c - The Hono request context.
 * @returns An HTML response with the agent's interactive page.
 * @throws {HTTPException} 404 if the agent is not found.
 */
export async function handleAgentPage(c: Context<HonoEnv>) {
  const { slug, slots, store } = c.var;
  const slot = await requireSlot(slug, slots, store);
  return c.html(renderAgentPage(slot.name ?? slug, `/${slug}`));
}

/**
 * Hono handler that upgrades an HTTP request to a WebSocket session.
 *
 * Prepares the agent worker and session, then delegates to
 * {@linkcode createSessionWSEvents} for WebSocket lifecycle management.
 */
export const handleWebSocket = upgradeWebSocket(async (c) => {
  const { slug, slots, store, kvStore, sessions } = c.var;
  const slot = await requireSlot(slug, slots, store);

  const setup = await _internals.prepareSession(slot, slug, store, kvStore);
  const resume = c.req.query("resume") !== undefined;

  return createSessionWSEvents(sessions, {
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
});

/**
 * Hono handler that serves static agent files (`client.js`, `client.js.map`).
 *
 * @param c - The Hono request context.
 * @returns The file contents with appropriate Content-Type header.
 * @throws {HTTPException} 404 if the agent or file is not found.
 */
export async function handleStaticFile(c: Context<HonoEnv>) {
  const { slug, slots, store } = c.var;
  await requireSlot(slug, slots, store);

  const STATIC_FILES: Record<
    string,
    { key: "client" | "client_map"; ct: string }
  > = {
    "client.js": { key: "client", ct: "application/javascript" },
    "client.js.map": { key: "client_map", ct: "application/json" },
  };

  const file = c.req.path.split("/").pop() ?? "";
  const spec = STATIC_FILES[file];
  if (!spec) throw new HTTPException(404, { message: "Not found" });

  const content = await store.getFile(slug, spec.key);
  if (!content) throw new HTTPException(404, { message: "Not found" });
  return c.body(content, {
    headers: {
      "Content-Type": spec.ct,
      "Cache-Control": "no-cache",
    },
  });
}

import { Hono } from "hono";
import { cors } from "hono/cors";
import { handleFavicon, renderLandingPage } from "./html.ts";
import { handleInstall } from "./install.ts";
import { handleDeploy } from "./deploy.ts";
import {
  handleAgentHealth,
  handleAgentPage,
  handleAgentRedirect,
  handleStaticFile,
  handleWebSocket,
} from "./transport_websocket.ts";
import type { AgentSlot } from "./worker_pool.ts";
import type { BundleStore } from "./bundle_store_tigris.ts";
import type { Session } from "./session.ts";
import { handleTwilioStream, handleTwilioVoice } from "./transport_twilio.ts";
import type { ServerContext } from "./types.ts";
import { handleDevWebSocket } from "./dev_session.ts";

export type App = Hono;

export function createOrchestrator(opts: {
  store: BundleStore;
}): { app: App } {
  const { store } = opts;

  const slots = new Map<string, AgentSlot>();
  const sessions = new Map<string, Session>();
  const ctx: ServerContext = { slots, sessions, store };

  const app = new Hono();

  // Cross-Origin-Isolation headers required for SharedArrayBuffer in capture worklet
  app.use("*", cors());
  app.use("*", async (c, next) => {
    await next();
    c.header("Cross-Origin-Opener-Policy", "same-origin");
    c.header("Cross-Origin-Embedder-Policy", "credentialless");
  });

  // Error handler
  app.onError((err, c) => {
    console.error("Unhandled error", {
      err,
      path: new URL(c.req.url).pathname,
    });
    return c.json({ error: "Internal server error" }, 500);
  });

  // Static routes
  app.get("/favicon.ico", () => handleFavicon());
  app.get("/favicon.svg", () => handleFavicon());
  app.get("/install", (c) => handleInstall(c));

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      agents: [...slots.values()].map((s) => ({
        slug: s.slug,
        name: s.name ?? s.slug,
        ready: !!s.worker,
      })),
    }));

  // Deploy
  app.post(
    "/:namespace/:slug/deploy",
    (c) => handleDeploy(c, { slots, store }),
  );

  // Twilio
  app.post("/:namespace/:slug/twilio/voice", (c) => {
    const slug = `${c.req.param("namespace")}/${c.req.param("slug")}`;
    return handleTwilioVoice(c, slug, ctx);
  });

  app.all("/:namespace/:slug/twilio/stream", (c) => {
    const slug = `${c.req.param("namespace")}/${c.req.param("slug")}`;
    return handleTwilioStream(c, slug, ctx);
  });

  // Dev control WebSocket
  app.all("/:namespace/:slug/dev", (c) => {
    const slug = `${c.req.param("namespace")}/${c.req.param("slug")}`;
    return handleDevWebSocket(c, slug, ctx);
  });

  // Agent routes
  app.get("/:namespace/:slug/health", (c) => {
    const slug = `${c.req.param("namespace")}/${c.req.param("slug")}`;
    return handleAgentHealth(c, slug, ctx);
  });

  app.all("/:namespace/:slug/websocket", (c) => {
    const slug = `${c.req.param("namespace")}/${c.req.param("slug")}`;
    return handleWebSocket(c, slug, ctx);
  });

  app.get("/:namespace/:slug/client.js", (c) => {
    const slug = `${c.req.param("namespace")}/${c.req.param("slug")}`;
    return handleStaticFile(c, slug, "client.js", ctx);
  });

  app.get("/:namespace/:slug/client.js.map", (c) => {
    const slug = `${c.req.param("namespace")}/${c.req.param("slug")}`;
    return handleStaticFile(c, slug, "client.js.map", ctx);
  });

  app.get("/:namespace/:slug/", (c) => {
    const slug = `${c.req.param("namespace")}/${c.req.param("slug")}`;
    return handleAgentPage(c, slug, ctx);
  });

  app.get("/:namespace/:slug", (c) => {
    const slug = `${c.req.param("namespace")}/${c.req.param("slug")}`;
    return handleAgentRedirect(c, slug, ctx);
  });

  // Landing page
  app.get("/", (c) => c.html(renderLandingPage()));

  return { app };
}

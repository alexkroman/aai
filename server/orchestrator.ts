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

type Params = Record<string, string>;
type Handler = (
  req: Request,
  params: Params,
) => Response | Promise<Response>;

type Route = {
  pattern: URLPattern;
  method?: string;
  handler: Handler;
};

function slug(params: Params): string {
  return `${params.namespace}/${params.slug}`;
}

const CORS_HEADERS: [string, string][] = [
  ["Access-Control-Allow-Origin", "*"],
  ["Access-Control-Allow-Methods", "*"],
  ["Access-Control-Allow-Headers", "*"],
  ["Cross-Origin-Opener-Policy", "same-origin"],
  ["Cross-Origin-Embedder-Policy", "credentialless"],
];

export function createOrchestrator(opts: {
  store: BundleStore;
}): { handler: (req: Request) => Promise<Response> } {
  const { store } = opts;

  const slots = new Map<string, AgentSlot>();
  const sessions = new Map<string, Session>();
  const ctx: ServerContext = { slots, sessions, store };

  const routes: Route[] = [
    // Static routes
    {
      pattern: new URLPattern({ pathname: "/favicon.ico" }),
      method: "GET",
      handler: () => handleFavicon(),
    },
    {
      pattern: new URLPattern({ pathname: "/favicon.svg" }),
      method: "GET",
      handler: () => handleFavicon(),
    },
    {
      pattern: new URLPattern({ pathname: "/install" }),
      method: "GET",
      handler: (req) => handleInstall(req),
    },
    {
      pattern: new URLPattern({ pathname: "/health" }),
      method: "GET",
      handler: () =>
        Response.json({
          status: "ok",
          agents: [...slots.values()].map((s) => ({
            slug: s.slug,
            name: s.name ?? s.slug,
            ready: !!s.worker,
          })),
        }),
    },

    // Deploy
    {
      pattern: new URLPattern({ pathname: "/:namespace/:slug/deploy" }),
      method: "POST",
      handler: (req, p) => handleDeploy(req, p, { slots, store }),
    },

    // Twilio
    {
      pattern: new URLPattern({ pathname: "/:namespace/:slug/twilio/voice" }),
      method: "POST",
      handler: (req, p) => handleTwilioVoice(req, slug(p), ctx),
    },
    {
      pattern: new URLPattern({ pathname: "/:namespace/:slug/twilio/stream" }),
      handler: (req, p) => handleTwilioStream(req, slug(p), ctx),
    },

    // Dev control WebSocket
    {
      pattern: new URLPattern({ pathname: "/:namespace/:slug/dev" }),
      handler: (req, p) => handleDevWebSocket(req, slug(p), ctx),
    },

    // Agent routes
    {
      pattern: new URLPattern({ pathname: "/:namespace/:slug/health" }),
      method: "GET",
      handler: (req, p) => handleAgentHealth(req, slug(p), ctx),
    },
    {
      pattern: new URLPattern({ pathname: "/:namespace/:slug/websocket" }),
      handler: (req, p) => handleWebSocket(req, slug(p), ctx),
    },
    {
      pattern: new URLPattern({ pathname: "/:namespace/:slug/client.js" }),
      method: "GET",
      handler: (req, p) => handleStaticFile(req, slug(p), "client.js", ctx),
    },
    {
      pattern: new URLPattern({ pathname: "/:namespace/:slug/client.js.map" }),
      method: "GET",
      handler: (req, p) => handleStaticFile(req, slug(p), "client.js.map", ctx),
    },
    {
      pattern: new URLPattern({ pathname: "/:namespace/:slug/" }),
      method: "GET",
      handler: (req, p) => handleAgentPage(req, slug(p), ctx),
    },
    {
      pattern: new URLPattern({ pathname: "/:namespace/:slug" }),
      method: "GET",
      handler: (req, p) => handleAgentRedirect(req, slug(p), ctx),
    },

    // Landing page
    {
      pattern: new URLPattern({ pathname: "/" }),
      method: "GET",
      handler: () =>
        new Response(renderLandingPage(), {
          headers: { "Content-Type": "text/html; charset=UTF-8" },
        }),
    },
  ];

  async function handler(req: Request): Promise<Response> {
    // CORS preflight
    if (req.method === "OPTIONS") {
      const res = new Response(null, { status: 204 });
      for (const [k, v] of CORS_HEADERS) res.headers.set(k, v);
      return res;
    }

    for (const route of routes) {
      if (route.method && req.method !== route.method) continue;
      const match = route.pattern.exec(req.url);
      if (!match) continue;
      try {
        const params = (match.pathname.groups ?? {}) as Params;
        const res = await route.handler(req, params);
        for (const [k, v] of CORS_HEADERS) res.headers.set(k, v);
        return res;
      } catch (err) {
        console.error("Unhandled error", {
          err,
          path: new URL(req.url).pathname,
        });
        return Response.json(
          { error: "Internal server error" },
          { status: 500 },
        );
      }
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return { handler };
}

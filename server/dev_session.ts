import { type DevRegister, DevRegisterSchema } from "@aai/core/protocol";
import { createWebSocketEndpoint } from "@aai/core/ws-endpoint";
import { createWorkerApi } from "@aai/core/worker-entry";
import type { AgentConfig, ToolSchema } from "@aai/sdk/types";
import { getBuiltinToolSchemas } from "./builtin_tools.ts";
import {
  type AgentSlot,
  createToolExecutor,
  trackSessionClose,
  trackSessionOpen,
} from "./worker_pool.ts";
import type { ServerContext } from "./types.ts";
import { claimNamespace, verifyOwner } from "./auth.ts";
import { signScopeToken, verifyScopeToken } from "./scope_token.ts";
import { loadPlatformConfig } from "./config.ts";
import { createSession, type Session } from "./session.ts";
import { handleSessionWebSocket } from "./ws_handler.ts";

export const _internals = {
  upgradeWebSocket: (req: Request) => Deno.upgradeWebSocket(req),
};

/** Wait for the first JSON message on a WebSocket. */
function nextJsonMessage(socket: WebSocket): Promise<unknown | null> {
  return new Promise((resolve) => {
    socket.addEventListener("message", function onMsg(event) {
      if (typeof event.data !== "string") return;
      if (event.data.length > 1_000_000) return;
      try {
        socket.removeEventListener("message", onMsg);
        resolve(JSON.parse(event.data));
      } catch { /* ignore non-JSON */ }
    });
    socket.addEventListener("close", () => resolve(null), { once: true });
  });
}

function sendError(socket: WebSocket, message: string) {
  socket.send(JSON.stringify({ type: "dev_error", message }));
}

export function handleDevWebSocket(
  req: Request,
  slug: string,
  ctx: ServerContext,
): Response {
  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return Response.json({ error: "Expected WebSocket upgrade" }, {
      status: 400,
    });
  }

  const { socket, response } = _internals.upgradeWebSocket(req);

  socket.addEventListener("open", () => {
    console.info("Dev control WebSocket connected", { slug });
  });

  socket.addEventListener("close", () => {
    console.info("Dev control WebSocket disconnected", { slug });
    ctx.devSlots.delete(slug);
    console.info("Removed dev slot", { slug });
  });

  socket.addEventListener("error", (event) => {
    const msg = event instanceof ErrorEvent ? event.message : "WebSocket error";
    console.error("Dev control WebSocket error", { slug, error: msg });
  });

  runDevSession(socket, slug, ctx);

  return response;
}

async function runDevSession(
  socket: WebSocket,
  slug: string,
  ctx: ServerContext,
): Promise<void> {
  const msg = await nextJsonMessage(socket);
  if (!msg) return;

  const parsed = DevRegisterSchema.safeParse(msg);
  if (!parsed.success) {
    sendError(socket, "First message must be dev_register with a token");
    socket.close();
    return;
  }

  const namespace = slug.split("/")[0];
  const ownerHash = await verifyOwner(
    parsed.data.token,
    namespace,
    ctx.store,
  );
  if (!ownerHash) {
    sendError(socket, `Namespace "${namespace}" is owned by another user.`);
    socket.close();
    return;
  }

  await claimNamespace(namespace, ownerHash, ctx.store);
  await registerDevAgent(socket, slug, parsed.data, ownerHash, ctx);
}

export async function registerDevAgent(
  ws: WebSocket,
  slug: string,
  msg: DevRegister,
  ownerHash: string,
  ctx: ServerContext,
): Promise<void> {
  const workerApi = createWorkerApi(createWebSocketEndpoint(ws));

  const agentConfig: AgentConfig = {
    name: msg.config.name,
    instructions: msg.config.instructions,
    greeting: msg.config.greeting,
    voice: msg.config.voice,
    stt_prompt: msg.config.stt_prompt,
    builtinTools: msg.config.builtinTools,
  };

  const customToolSchemas = msg.toolSchemas;
  const allToolSchemas: ToolSchema[] = [
    ...customToolSchemas,
    ...getBuiltinToolSchemas(agentConfig.builtinTools ?? []),
  ];

  const existing = ctx.devSlots.get(slug);
  if (existing?.worker) {
    existing.worker.handle.terminate();
  }

  const devToken = await signScopeToken(ctx.scopeKey, { ownerHash, slug });

  const slot: AgentSlot = {
    slug,
    env: msg.env,
    transport: msg.transport,
    config: agentConfig,
    name: agentConfig.name ?? slug,
    toolSchemas: customToolSchemas,
    ownerHash,
    activeSessions: existing?.activeSessions ?? 0,
    worker: {
      handle: { terminate() {} },
      api: workerApi,
    },
    _dev: true,
  };
  ctx.devSlots.set(slug, slot);

  console.info("Dev agent registered", {
    slug,
    name: slot.name,
    tools: allToolSchemas.map((t) => t.name),
  });

  ws.send(JSON.stringify({ type: "dev_registered", slug, devToken }));
}

export async function handleDevSessionWebSocket(
  req: Request,
  slug: string,
  ctx: ServerContext,
): Promise<Response> {
  const slot = ctx.devSlots.get(slug);
  if (!slot) {
    return Response.json({ error: "No dev session for this agent" }, {
      status: 404,
    });
  }

  const token = new URL(req.url).searchParams.get("token");
  if (!token) {
    return Response.json({ error: "Missing token" }, { status: 401 });
  }
  const scope = await verifyScopeToken(ctx.scopeKey, token);
  if (!scope || scope.slug !== slug) {
    return Response.json({ error: "Invalid dev token" }, { status: 403 });
  }

  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return Response.json({ error: "Expected WebSocket upgrade" }, {
      status: 400,
    });
  }

  const config = slot.config!;
  const builtinTools = getBuiltinToolSchemas(config.builtinTools ?? []);
  const toolSchemas = [...(slot.toolSchemas ?? []), ...builtinTools];
  const kvCtx = slot.ownerHash
    ? { kvStore: ctx.kvStore, scope: { ownerHash: slot.ownerHash, slug } }
    : undefined;
  const { executeTool, getWorkerApi } = createToolExecutor(
    slot,
    ctx.store,
    kvCtx,
  );

  const resume = new URL(req.url).searchParams.has("resume");
  const { socket, response } = _internals.upgradeWebSocket(req);
  handleSessionWebSocket(socket, ctx.sessions as Map<string, Session>, {
    createSession: (sessionId, ws) =>
      createSession({
        id: sessionId,
        agent: slug,
        transport: ws,
        agentConfig: config,
        toolSchemas,
        platformConfig: loadPlatformConfig(slot.env),
        executeTool,
        getWorkerApi,
        env: slot.env,
        skipGreeting: resume,
      }),
    logContext: { slug, dev: "true" },
    onOpen: () => trackSessionOpen(slot),
    onClose: () => trackSessionClose(slot),
  });
  return response;
}

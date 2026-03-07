import { type DevRegister, DevRegisterSchema } from "../core/_dev_protocol.ts";
import { createWebSocketTarget } from "../core/_rpc.ts";
import { createWorkerRpc } from "./rpc.ts";
import type { AgentConfig, ToolSchema } from "./types.ts";
import { getBuiltinToolSchemas } from "./builtin_tools.ts";
import type { AgentInfo, AgentSlot, WorkerHandle } from "./worker_pool.ts";
import type { Session } from "./session.ts";
import type { BundleStore } from "./bundle_store_tigris.ts";
import { hashApiKey } from "./deploy.ts";

export interface DevSessionContext {
  slots: Map<string, AgentSlot>;
  sessions: Map<string, Session>;
  store: BundleStore;
}

export function handleDevWebSocket(
  req: Request,
  slug: string,
  ctx: DevSessionContext,
): Response {
  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return Response.json(
      { error: "Expected WebSocket upgrade" },
      { status: 400 },
    );
  }

  const url = new URL(req.url);
  const apiKey = url.searchParams.get("token");
  if (!apiKey) {
    return Response.json(
      { error: "Missing token parameter" },
      { status: 401 },
    );
  }

  const { socket, response } = Deno.upgradeWebSocket(req);

  socket.addEventListener("open", () => {
    console.info("Dev control WebSocket connected", { slug });
  });

  // Wait for the registration message, then switch to RPC mode
  socket.addEventListener("message", async function onRegister(event) {
    if (typeof event.data !== "string") return;

    let json: unknown;
    try {
      json = JSON.parse(event.data);
    } catch {
      return;
    }

    // Ignore RPC messages (numeric id) before registration
    if (typeof (json as Record<string, unknown>).id === "number") return;

    const parsed = DevRegisterSchema.safeParse(json);
    if (!parsed.success) {
      socket.send(JSON.stringify({
        type: "dev_error",
        message: `Invalid registration: ${parsed.error.message}`,
      }));
      return;
    }

    // Remove this listener — after registration, _rpc.ts handles messages
    socket.removeEventListener("message", onRegister);

    const ownerHash = await hashApiKey(apiKey);
    await registerDevAgent(socket, slug, parsed.data, ownerHash, ctx);
  });

  socket.addEventListener("close", () => {
    console.info("Dev control WebSocket disconnected", { slug });
    const slot = ctx.slots.get(slug);
    if (slot?._dev) {
      ctx.slots.delete(slug);
      console.info("Removed dev slot", { slug });
    }
  });

  socket.addEventListener("error", (event) => {
    const msg = event instanceof ErrorEvent ? event.message : "WebSocket error";
    console.error("Dev control WebSocket error", { slug, error: msg });
  });

  return response;
}

async function registerDevAgent(
  ws: WebSocket,
  slug: string,
  msg: DevRegister,
  ownerHash: string,
  ctx: DevSessionContext,
): Promise<void> {
  // Create a MessageTarget adapter so standard RPC works over this WebSocket
  const target = createWebSocketTarget(ws);

  // createWorkerRpc gives us the same WorkerApi as a local Worker would
  const workerApi = createWorkerRpc(target);

  const agentConfig: AgentConfig = {
    name: msg.config.name,
    instructions: msg.config.instructions,
    greeting: msg.config.greeting,
    voice: msg.config.voice,
    prompt: msg.config.prompt,
    builtinTools: msg.config.builtinTools as AgentConfig["builtinTools"],
  };

  const allToolSchemas: ToolSchema[] = [
    ...msg.toolSchemas as ToolSchema[],
    ...getBuiltinToolSchemas(agentConfig.builtinTools ?? []),
  ];

  const noopHandle: WorkerHandle = { terminate() {} };

  const agentInfo: AgentInfo = {
    slug,
    name: msg.config.name ?? slug,
    worker: noopHandle,
    workerApi,
    config: agentConfig,
    toolSchemas: allToolSchemas,
  };

  // Replace any existing slot
  const existing = ctx.slots.get(slug);
  if (existing?.live) {
    existing.live.worker.terminate();
  }

  const slot: AgentSlot = {
    slug,
    env: msg.env,
    transport: msg.transport,
    config: agentConfig,
    name: agentConfig.name ?? slug,
    toolSchemas: allToolSchemas,
    activeSessions: existing?.activeSessions ?? 0,
    live: agentInfo,
    _dev: true,
  };
  ctx.slots.set(slug, slot);

  // Store client.js so the server can serve it
  await ctx.store.putAgent({
    slug,
    env: msg.env,
    transport: msg.transport,
    worker: "", // no worker needed — tools run on CLI
    client: msg.client,
    owner_hash: ownerHash,
  });

  console.info("Dev agent registered", {
    slug,
    name: agentInfo.name,
    tools: allToolSchemas.map((t) => t.name),
  });

  ws.send(JSON.stringify({ type: "dev_registered", slug }));
}

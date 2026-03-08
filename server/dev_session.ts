import type { Context } from "hono";
import { type DevRegister, DevRegisterSchema } from "../core/_protocol.ts";
import { createWebSocketTarget } from "../core/_rpc.ts";
import { createWorkerApi } from "../core/_worker_entry.ts";
import type { AgentConfig, ToolSchema } from "../sdk/types.ts";
import { getBuiltinToolSchemas } from "./builtin_tools.ts";
import type { AgentSlot } from "./worker_pool.ts";
import type { ServerContext } from "./types.ts";
import { hashApiKey } from "./deploy.ts";

export function handleDevWebSocket(
  c: Context,
  slug: string,
  ctx: ServerContext,
): Response {
  const req = c.req.raw;
  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return c.json({ error: "Expected WebSocket upgrade" }, 400);
  }

  const apiKey = c.req.query("token");
  if (!apiKey) {
    return c.json({ error: "Missing token parameter" }, 401);
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
  ctx: ServerContext,
): Promise<void> {
  // Create a MessageTarget adapter so standard RPC works over this WebSocket
  const workerApi = createWorkerApi(createWebSocketTarget(ws));

  const agentConfig: AgentConfig = {
    name: msg.config.name,
    instructions: msg.config.instructions,
    greeting: msg.config.greeting,
    voice: msg.config.voice,
    prompt: msg.config.prompt,
    builtinTools: msg.config.builtinTools as AgentConfig["builtinTools"],
  };

  const customToolSchemas = msg.toolSchemas as ToolSchema[];
  const allToolSchemas: ToolSchema[] = [
    ...customToolSchemas,
    ...getBuiltinToolSchemas(agentConfig.builtinTools ?? []),
  ];

  // Replace any existing slot
  const existing = ctx.slots.get(slug);
  if (existing?.worker) {
    existing.worker.handle.terminate();
  }

  const slot: AgentSlot = {
    slug,
    env: msg.env,
    transport: msg.transport,
    config: agentConfig,
    name: agentConfig.name ?? slug,
    toolSchemas: customToolSchemas,
    activeSessions: existing?.activeSessions ?? 0,
    // Dev slots wire RPC directly to the CLI WebSocket instead of a Worker
    worker: {
      handle: { terminate() {} },
      api: workerApi,
    },
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
    name: slot.name,
    tools: allToolSchemas.map((t) => t.name),
  });

  ws.send(JSON.stringify({ type: "dev_registered", slug }));
}

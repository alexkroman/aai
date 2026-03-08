import { loadPlatformConfig } from "./config.ts";
import type { AgentSlot } from "./worker_pool.ts";
import type { BundleStore } from "./bundle_store_tigris.ts";
import { DeployBodySchema, normalizeTransport } from "../sdk/_schema.ts";

export async function hashApiKey(apiKey: string): Promise<string> {
  const data = new TextEncoder().encode(apiKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function handleDeploy(
  req: Request,
  namespace: string,
  slug: string,
  ctx: { slots: Map<string, AgentSlot>; store: BundleStore },
): Promise<Response> {
  const { slots, store } = ctx;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return Response.json(
      { error: "Missing Authorization header (Bearer <API_KEY>)" },
      { status: 400 },
    );
  }
  const apiKey = authHeader.slice("Bearer ".length);
  const ownerHash = await hashApiKey(apiKey);

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = DeployBodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: `Invalid deploy body: ${parsed.error.message}` },
      { status: 400 },
    );
  }
  const body = parsed.data;

  try {
    loadPlatformConfig(body.env);
  } catch (err: unknown) {
    return Response.json(
      { error: `Invalid platform config: ${(err as Error).message}` },
      { status: 400 },
    );
  }

  // Check namespace ownership — claim implicitly on first deploy
  const nsOwner = await store.getNamespaceOwner(namespace);
  if (nsOwner && nsOwner !== ownerHash) {
    return Response.json(
      { error: `Namespace "${namespace}" is owned by another user.` },
      { status: 403 },
    );
  }
  if (!nsOwner) {
    await store.putNamespaceOwner(namespace, ownerHash);
  }

  const compositeSlug = `${namespace}/${slug}`;

  const existing = slots.get(compositeSlug);
  if (existing?.live) {
    console.info("Replacing existing deploy", { slug: compositeSlug });
    existing.live.worker.terminate();
    existing.live = undefined;
    existing.initializing = undefined;
  }

  const transport = normalizeTransport(body.transport);

  await store.putAgent({
    slug: compositeSlug,
    env: body.env,
    transport,
    worker: body.worker,
    client: body.client,
    owner_hash: ownerHash,
    config: body.config,
    toolSchemas: body.toolSchemas,
  });

  const slot: AgentSlot = {
    slug: compositeSlug,
    env: body.env,
    transport,
    config: body.config as AgentSlot["config"],
    name: body.config?.name,
    toolSchemas: body.toolSchemas,
    activeSessions: 0,
  };
  slots.set(compositeSlug, slot);

  console.info("Deploy received", { slug: compositeSlug, transport });

  return Response.json({
    ok: true,
    message: `Deployed ${compositeSlug}`,
  });
}

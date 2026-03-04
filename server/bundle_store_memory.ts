import type { AgentMetadata } from "./worker_pool.ts";
import type { BundleStore, FileKey } from "./bundle_store_tigris.ts";

interface StoredAgent {
  manifest: AgentMetadata;
  worker: string;
  client: string;
  client_map?: string;
}

export class MemoryBundleStore implements BundleStore {
  #agents = new Map<string, StoredAgent>();
  putAgent(bundle: {
    slug: string;
    env: Record<string, string>;
    transport: ("websocket" | "twilio")[];
    worker: string;
    client: string;
    client_map?: string;
  }): Promise<void> {
    this.#agents.set(bundle.slug, {
      manifest: {
        slug: bundle.slug,
        env: bundle.env,
        transport: bundle.transport,
      },
      worker: bundle.worker,
      client: bundle.client,
      client_map: bundle.client_map,
    });
    return Promise.resolve();
  }

  getManifest(slug: string): Promise<AgentMetadata | null> {
    return Promise.resolve(this.#agents.get(slug)?.manifest ?? null);
  }

  getFile(slug: string, file: FileKey): Promise<string | null> {
    const agent = this.#agents.get(slug);
    if (!agent) return Promise.resolve(null);
    if (file === "worker") return Promise.resolve(agent.worker);
    if (file === "client") return Promise.resolve(agent.client);
    if (file === "client_map") return Promise.resolve(agent.client_map ?? null);
    return Promise.resolve(null);
  }

  deleteAgent(slug: string): Promise<void> {
    this.#agents.delete(slug);
    return Promise.resolve();
  }

  close(): void {}

  [Symbol.dispose](): void {
    this.close();
  }
}

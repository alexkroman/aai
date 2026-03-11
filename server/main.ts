import { deadline } from "@std/async/deadline";
import { createOrchestrator } from "./orchestrator.ts";
import { createBundleStore, createS3Client } from "./bundle_store_tigris.ts";
import { createKvStore } from "./kv.ts";
import { importScopeKey } from "./scope_token.ts";

try {
  const { load } = await import("@std/dotenv");
  await load({ export: true });
} catch { /* .env not found — fine */ }

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    console.error(`FATAL: ${name} must be set`);
    Deno.exit(1);
  }
  return value;
}

const bucket = requireEnv("BUCKET_NAME");
const s3 = createS3Client();
const store = createBundleStore(s3, bucket);

const kvStore = createKvStore(
  requireEnv("UPSTASH_REDIS_REST_URL"),
  requireEnv("UPSTASH_REDIS_REST_TOKEN"),
);

const scopeKey = await importScopeKey(requireEnv("KV_SCOPE_SECRET"));

const handler = createOrchestrator({ store, kvStore, scopeKey });

const port = parseInt(Deno.env.get("PORT") ?? "3100");
const abort = new AbortController();
Deno.addSignalListener("SIGTERM", () => {
  console.info("SIGTERM received — draining connections...");
  abort.abort();
});

const server = Deno.serve(
  { port, hostname: "0.0.0.0", signal: abort.signal, onListen: () => {} },
  handler,
);

console.info(`http://localhost:${port}`);

await deadline(server.finished, 5_000).catch(() => {});
console.info("Shutdown complete");

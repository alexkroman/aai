import { createOrchestrator } from "./orchestrator.ts";
import { createBundleStore, createS3Client } from "./bundle_store_tigris.ts";

try {
  const { load } = await import("@std/dotenv");
  await load({ export: true });
} catch { /* .env not found — fine */ }

const bucket = Deno.env.get("BUCKET_NAME") ?? "local";
let s3;
if (Deno.env.get("AWS_ENDPOINT_URL_S3")) {
  s3 = createS3Client();
} else {
  const { createMemoryS3Client } = await import("./bundle_store_tigris.ts");
  s3 = createMemoryS3Client();
  console.info("Using in-memory storage (no S3 configured)");
}
const store = createBundleStore(s3, bucket);
const { app } = createOrchestrator({ store });

const port = parseInt(Deno.env.get("PORT") ?? "3100");
const server = Deno.serve(
  { port, hostname: "0.0.0.0", onListen: () => {} },
  app.fetch,
);

console.info(`http://localhost:${port}`);

Deno.addSignalListener("SIGTERM", () => {
  console.info("SIGTERM received — draining connections...");
  const drain = server.shutdown();
  const force = new Promise<void>((r) => setTimeout(r, 5_000));
  Promise.race([drain, force]).then(() => {
    console.info("Shutdown complete");
    Deno.exit(0);
  });
});

import { log } from "./_output.ts";

export interface DeployOpts {
  url: string;
  bundleDir: string;
  slug: string;
  dryRun: boolean;
  apiKey: string;
}

export async function runDeploy(
  opts: DeployOpts,
  doFetch: typeof globalThis.fetch = globalThis.fetch,
  readTextFile: typeof Deno.readTextFile = Deno.readTextFile,
): Promise<void> {
  const dir = `${opts.bundleDir}/${opts.slug}`;

  let manifest: {
    slug: string;
    env: Record<string, string>;
    transport?: string[];
  };
  let worker: string;
  let client: string;
  try {
    manifest = JSON.parse(await readTextFile(`${dir}/manifest.json`));
    worker = await readTextFile(`${dir}/worker.js`);
    client = await readTextFile(`${dir}/client.js`);
  } catch {
    throw new Error(
      `no bundle found for ${opts.slug} in ${opts.bundleDir}/ — run "aai build" first`,
    );
  }

  if (opts.dryRun) {
    log.stepInfo("Dry run", "would deploy:");
    log.info(`${opts.slug} → ${opts.url}/${opts.slug}/`);
    return;
  }

  log.step("Deploy", `${opts.slug} → ${opts.url}`);

  const resp = await doFetch(`${opts.url}/deploy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      slug: manifest.slug,
      env: manifest.env,
      worker,
      client,
      transport: manifest.transport,
    }),
  });

  if (resp.ok) {
    log.step("Done", `deployed ${opts.slug}`);
    const transport = manifest.transport ?? ["websocket"];
    if (transport.includes("websocket")) {
      log.info(`websocket → ${opts.url}/websocket/${opts.slug}/`);
    }
    if (transport.includes("twilio")) {
      log.info(`twilio  → ${opts.url}/twilio/${opts.slug}/voice`);
    }
  } else {
    const text = await resp.text();
    throw new Error(`deploy failed (${resp.status}): ${text}`);
  }
}

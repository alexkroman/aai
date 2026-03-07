import { info, step, stepInfo, warn } from "./_output.ts";
import type { BundleOutput } from "./_bundler.ts";

export interface DeployOpts {
  url: string;
  bundle: BundleOutput;
  slug: string;
  dryRun: boolean;
  apiKey: string;
}

export async function runDeploy(opts: DeployOpts): Promise<void> {
  const manifest = JSON.parse(opts.bundle.manifest);
  const worker = opts.bundle.worker;
  const client = opts.bundle.client;

  if (opts.dryRun) {
    stepInfo("Dry run", "would deploy:");
    info(`${opts.slug} -> ${opts.url}/${opts.slug}/`);
    return;
  }

  const resp = await fetch(`${opts.url}/deploy`, {
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
      config: manifest.config,
      toolSchemas: manifest.toolSchemas,
    }),
  });

  if (resp.ok) {
    const transport = manifest.transport ?? ["websocket"];
    const urls: string[] = [];
    if (transport.includes("websocket")) {
      urls.push(`${opts.url}/${opts.slug}/`);
    }
    if (transport.includes("twilio")) {
      urls.push(`${opts.url}/twilio/${opts.slug}/voice`);
    }
    step("Deploy", `${opts.slug} -> ${urls[0] ?? opts.url}`);
    for (const url of urls.slice(1)) {
      info(url);
    }

    // Health check: best-effort verification
    try {
      const healthResp = await fetch(`${opts.url}/${opts.slug}/health`);
      const ok = healthResp.ok &&
        (await healthResp.json()).status === "ok";
      if (ok) {
        step("Ready", opts.slug);
      } else {
        warn(
          `${opts.slug} deployed but health check failed -- check for runtime errors`,
        );
      }
    } catch {
      // Health check is best-effort
    }
  } else {
    const text = await resp.text();
    throw new Error(`deploy failed (${resp.status}): ${text}`);
  }
}

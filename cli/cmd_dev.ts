import { parseArgs } from "@std/cli/parse-args";
import { debounce } from "@std/async/debounce";
import { exists } from "@std/fs/exists";
import { dirname, fromFileUrl, join } from "@std/path";
import { bold, cyan, dim, green } from "@std/fmt/colors";
import { error, step, stepInfo } from "./_output.ts";
import { runBuild } from "./build.ts";
import type { ValidationResult } from "./_validate.ts";
import type { AgentEntry } from "./_discover.ts";
import { spawnLocalWorker } from "./_local_worker.ts";
import { createWebSocketTarget, serveRpc } from "../core/_rpc.ts";

const DEFAULT_SERVER = "https://aai-agent.fly.dev";

export async function runDevCommand(args: string[]): Promise<number> {
  const flags = parseArgs(args, {
    string: ["port", "server"],
    alias: { h: "help", p: "port", s: "server" },
    boolean: ["help"],
  });

  if (flags.help) {
    console.log(
      `${green(bold("aai dev"))} — Run local dev server with file watching

${bold("USAGE:")}
  ${cyan("aai dev")}

${bold("OPTIONS:")}
  ${cyan("-p, --port")} ${
        dim("<number>")
      }   Port for local proxy server (default: 3100)
  ${cyan("-s, --server")} ${
        dim("<url>")
      } Production server URL (default: ${DEFAULT_SERVER})
  ${cyan("-h, --help")}             Show this help message
`,
    );
    return 0;
  }

  const cwd = Deno.env.get("INIT_CWD") || Deno.cwd();
  const port = parseInt(flags.port ?? "3100");
  const serverUrl = flags.server ?? DEFAULT_SERVER;

  const { getApiKey, getNamespace, resolveSlug, saveAgentLink } = await import(
    "./_discover.ts"
  );
  const apiKey = await getApiKey();
  const namespace = await getNamespace();

  // Write CLAUDE.md if missing
  const claudePath = join(cwd, "CLAUDE.md");
  if (!await exists(claudePath)) {
    const cliDir = dirname(fromFileUrl(import.meta.url));
    const srcClaude = join(cliDir, "claude.md");
    await Deno.copyFile(srcClaude, claudePath);
    step(
      "Wrote",
      "CLAUDE.md — read this file for the aai agent API reference",
    );
  }

  // Initial build
  let result;
  try {
    result = await runBuild({ agentDir: cwd });
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const slug = await resolveSlug(cwd, namespace, result.agent.slug);
  const fullPath = `${namespace}/${slug}`;

  // Save the link between this directory and the namespace/slug
  await saveAgentLink(cwd, { namespace, slug, apiKey });

  // Spawn local worker for tool execution
  let localWorker = spawnLocalWorker(
    result.bundle.worker,
    slug,
  );

  // Read agent config from manifest (extracted at build time)
  let manifest = JSON.parse(result.bundle.manifest);
  let clientCode = result.bundle.client;

  // Connect control WebSocket to production server
  const wsUrl = serverUrl.replace(/^http/, "ws");
  let controlWs = await connectAndRegister(
    wsUrl,
    apiKey,
    namespace,
    result.agent,
    manifest,
    clientCode,
    localWorker,
  );

  // Start local proxy server
  const proxyServer = startLocalProxy(
    port,
    fullPath,
    manifest.config?.name ?? slug,
    serverUrl,
    () => clientCode,
  );

  step("Ready", fullPath);
  printSummary(
    result.agent,
    result.validation,
    namespace,
    `http://localhost:${port}`,
  );
  stepInfo("Watch", "for changes...");

  // Watch for file changes
  const ac = new AbortController();
  const watcher = Deno.watchFs([cwd], { recursive: true });

  const WATCHED_EXTENSIONS = [
    ".ts",
    ".tsx",
    ".json",
    ".md",
    ".csv",
    ".txt",
    ".html",
  ];

  let building = false;
  let pendingRebuild = false;

  const rebuild = debounce(async () => {
    if (building) {
      pendingRebuild = true;
      return;
    }
    building = true;
    try {
      const freshResult = await runBuild({ agentDir: cwd });

      // Respawn local worker
      localWorker.terminate();
      localWorker = spawnLocalWorker(
        freshResult.bundle.worker,
        slug,
      );
      manifest = JSON.parse(freshResult.bundle.manifest);
      clientCode = freshResult.bundle.client;

      // Reconnect control WS with updated config
      controlWs.close();
      controlWs = await connectAndRegister(
        wsUrl,
        apiKey,
        namespace,
        freshResult.agent,
        manifest,
        clientCode,
        localWorker,
      );

      step("Ready", fullPath);
      printSummary(
        freshResult.agent,
        freshResult.validation,
        namespace,
        `http://localhost:${port}`,
      );
    } catch (err: unknown) {
      error(err instanceof Error ? err.message : String(err));
    } finally {
      building = false;
      if (pendingRebuild) {
        pendingRebuild = false;
        rebuild();
      }
    }
  }, 300);

  const cleanup = () => {
    ac.abort();
    watcher.close();
    localWorker.terminate();
    controlWs.close();
    proxyServer.shutdown();
  };

  Deno.addSignalListener("SIGINT", cleanup);
  Deno.addSignalListener("SIGTERM", cleanup);

  for await (const event of watcher) {
    if (ac.signal.aborted) break;
    const hasRelevantChange = event.paths.some((p) =>
      WATCHED_EXTENSIONS.some((ext) => p.endsWith(ext))
    );
    if (!hasRelevantChange) continue;
    if (event.paths.every((p) => p.includes("_test.ts"))) continue;
    rebuild();
  }

  return 0;
}

/** Connect to the server, send registration, then serve RPC over the same WebSocket. */
function connectAndRegister(
  wsUrl: string,
  apiKey: string,
  namespace: string,
  agent: AgentEntry,
  manifest: {
    config?: {
      name?: string;
      instructions: string;
      greeting: string;
      voice: string;
      prompt?: string;
      builtinTools?: string[];
    };
    toolSchemas?: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }[];
  },
  clientCode: string,
  localWorker: ReturnType<typeof spawnLocalWorker>,
): Promise<WebSocket> {
  const fullPath = `${namespace}/${agent.slug}`;
  const url = `${wsUrl}/${fullPath}/dev?token=${encodeURIComponent(apiKey)}`;

  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url);

    ws.addEventListener("open", () => {
      // Send registration (non-RPC message)
      ws.send(JSON.stringify({
        type: "dev_register",
        config: manifest.config ?? {
          instructions: "",
          greeting: "",
          voice: "luna",
        },
        toolSchemas: manifest.toolSchemas ?? [],
        env: agent.env,
        transport: agent.transport,
        client: clientCode,
      }));
    });

    // Listen for the registration acknowledgment
    ws.addEventListener("message", function onRegAck(event) {
      if (typeof event.data !== "string") return;
      let msg: { type?: string; slug?: string; message?: string };
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      // Ignore RPC messages (they have numeric id) during registration
      if (typeof (msg as Record<string, unknown>).id === "number") return;

      if (msg.type === "dev_registered") {
        ws.removeEventListener("message", onRegAck);
        step(
          "Connected",
          `${wsUrl.replace(/^ws/, "http")}/${fullPath}`,
        );

        // Switch to RPC mode — serve executeTool/invokeHook over this
        // WebSocket using the same RPC protocol as Worker postMessage.
        const target = createWebSocketTarget(ws);
        serveRpc(target, {
          executeTool: ({ name, args, sessionId }: Record<string, unknown>) =>
            localWorker.workerApi.executeTool(
              name as string,
              args as Record<string, unknown>,
              sessionId as string | undefined,
              30_000,
            ),
          invokeHook: (
            { hook, sessionId, text, error: err }: Record<string, unknown>,
          ) =>
            localWorker.workerApi.invokeHook(
              hook as string,
              sessionId as string,
              {
                text: text as string | undefined,
                error: err as string | undefined,
              },
              5_000,
            ),
        });

        resolve(ws);
      } else if (msg.type === "dev_error") {
        reject(new Error(msg.message ?? "Server rejected registration"));
      }
    });

    ws.addEventListener("error", (event) => {
      const msg = event instanceof ErrorEvent
        ? event.message
        : "WebSocket error";
      reject(new Error(`Failed to connect to server: ${msg}`));
    });

    ws.addEventListener("close", (event) => {
      if (!event.wasClean) {
        error(`Control WebSocket closed: ${event.reason || "connection lost"}`);
      }
    });
  });
}

function startLocalProxy(
  port: number,
  fullPath: string,
  agentName: string,
  serverUrl: string,
  getClientCode: () => string,
): Deno.HttpServer {
  const wsUrl = serverUrl.replace(/^http/, "ws");

  step("Server", `http://localhost:${port}`);

  return Deno.serve(
    { port, hostname: "0.0.0.0", onListen: () => {} },
    async (req: Request) => {
      const url = new URL(req.url);
      const path = url.pathname;

      // Serve agent HTML page
      if (path === `/${fullPath}`) {
        return Response.redirect(
          `http://localhost:${port}/${fullPath}/`,
          301,
        );
      }
      if (path === `/${fullPath}/`) {
        return new Response(renderDevPage(agentName, `/${fullPath}`), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      // Serve client.js from in-memory build
      if (path === `/${fullPath}/client.js`) {
        return new Response(getClientCode(), {
          headers: {
            "Content-Type": "application/javascript",
            "Cache-Control": "no-cache",
          },
        });
      }

      // Proxy WebSocket to production server
      if (path === `/${fullPath}/websocket`) {
        if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
          return Response.json(
            { error: "Expected WebSocket upgrade" },
            { status: 400 },
          );
        }

        const { socket: clientWs, response } = Deno.upgradeWebSocket(req);
        const targetUrl = `${wsUrl}/${fullPath}/websocket${url.search}`;
        const serverWs = new WebSocket(targetUrl);
        serverWs.binaryType = "arraybuffer";

        serverWs.addEventListener("open", () => {
          clientWs.addEventListener("message", (e) => {
            if (serverWs.readyState === WebSocket.OPEN) {
              serverWs.send(e.data);
            }
          });
        });

        serverWs.addEventListener("message", (e) => {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(e.data);
          }
        });

        serverWs.addEventListener("close", () => {
          if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
        });
        clientWs.addEventListener("close", () => {
          if (serverWs.readyState === WebSocket.OPEN) serverWs.close();
        });
        serverWs.addEventListener("error", () => {
          if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
        });
        clientWs.addEventListener("error", () => {
          if (serverWs.readyState === WebSocket.OPEN) serverWs.close();
        });

        return response;
      }

      // Proxy favicon
      if (path === "/favicon.ico" || path === "/favicon.svg") {
        try {
          return await fetch(`${serverUrl}${path}`);
        } catch {
          return new Response(null, { status: 404 });
        }
      }

      return Response.json({ error: "Not found" }, { status: 404 });
    },
  );
}

function renderDevPage(name: string, basePath: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(name)}</title>
    <meta name="description" content="${esc(name)} — AI voice agent">
    <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  </head>
  <body>
    <main id="app"></main>
    <script type="module" src="${esc(basePath)}/client.js"></script>
  </body>
</html>`;
}

function printSummary(
  agent: AgentEntry,
  validation: ValidationResult,
  namespace: string,
  serverUrl: string,
): void {
  const tools = [
    ...(validation.builtinTools ?? []),
    ...(validation.tools ?? []),
  ];

  const fullPath = `${namespace}/${agent.slug}`;

  if (agent.transport.includes("websocket")) {
    stepInfo("App", `${serverUrl}/${fullPath}/`);
  }
  if (agent.transport.includes("twilio")) {
    stepInfo("Twilio", `(via production server)`);
  }

  stepInfo("Agent", validation.name ?? agent.slug);
  if (validation.voice) {
    stepInfo("Voice", validation.voice);
  }
  if (tools.length > 0) {
    stepInfo("Tools", tools.join(", "));
  }
}

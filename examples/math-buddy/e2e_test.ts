// End-to-end voice test for math-buddy using Astral headless browser.
//
// Starts the dev server, generates TTS audio for a user utterance,
// injects it via the WebSocket (bypassing browser audio), and verifies
// the agent responds.
//
// Run:
//   deno test --allow-all --unstable-worker-options examples/math-buddy/e2e_test.ts

import { load as loadEnv } from "@std/dotenv";
import { launch, type Page } from "@astral/astral";
import type { Browser } from "@astral/astral";
import { resolve } from "@std/path";
import { encodeBase64 } from "@std/encoding/base64";
import { loadAgent } from "../../cli/_discover.ts";
import { bundleAgent } from "../../cli/_bundler.ts";
import { deployToLocal, spawn, waitForServer } from "../../cli/_server.ts";
import { stop as stopEsbuild } from "esbuild";
import { createTtsClient } from "../../server/tts.ts";
import { DEFAULT_TTS_CONFIG } from "../../server/types.ts";

// Load env from examples/math-buddy/.env and root .env
await loadEnv({ envPath: resolve("examples/math-buddy/.env"), export: true });
await loadEnv({ export: true }).catch(() => {});

const TTS_SAMPLE_RATE = 24_000;
const STT_SAMPLE_RATE = 16_000;

// ── Helpers ──

function findFreePort(): number {
  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return port;
}

async function pollPage(
  page: Page,
  fn: () => boolean | string,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await page.evaluate(fn);
    if (result) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  // Dump page state for debugging
  const debugState = await page.evaluate(() => {
    return {
      label: document.querySelector(".label")?.textContent ?? "(none)",
      bodyText: document.body.innerText.slice(0, 500),
      wsLog: (globalThis as unknown as Record<string, unknown>).__wsLog ?? [],
    };
  });
  console.log(
    "DEBUG page state at timeout:",
    JSON.stringify(debugState, null, 2),
  );
  throw new Error(`Timeout: ${label} (${timeoutMs}ms)`);
}

// ── TTS audio generation ──

async function generateTtsAudio(text: string): Promise<Uint8Array> {
  const apiKey = Deno.env.get("ASSEMBLYAI_TTS_API_KEY");
  if (!apiKey) throw new Error("ASSEMBLYAI_TTS_API_KEY env var is required");

  const tts = createTtsClient({ ...DEFAULT_TTS_CONFIG, apiKey });
  const chunks: Uint8Array[] = [];
  await tts.synthesize(text, (chunk) => chunks.push(chunk));
  tts.close();

  const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
  const pcm = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    pcm.set(chunk, offset);
    offset += chunk.length;
  }
  return pcm;
}

// ── Resample 24kHz → 16kHz (linear interpolation) ──

function resample(pcm16at24k: Uint8Array): Uint8Array {
  const src = new Int16Array(
    pcm16at24k.buffer,
    pcm16at24k.byteOffset,
    pcm16at24k.byteLength / 2,
  );
  const ratio = STT_SAMPLE_RATE / TTS_SAMPLE_RATE; // 2/3
  const outLen = Math.floor(src.length * ratio);
  const dst = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i / ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, src.length - 1);
    const frac = srcIdx - lo;
    dst[i] = Math.round(src[lo] * (1 - frac) + src[hi] * frac);
  }
  return new Uint8Array(dst.buffer);
}

// ── Test ──

Deno.test({
  name: "e2e: math-buddy voice interaction",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const userText = "What is 5 plus 3?";
    const port = findFreePort();
    const baseUrl = `http://localhost:${port}`;
    const tmpDir = await Deno.makeTempDir({ prefix: "e2e-" });
    let orchestrator: Deno.ChildProcess | null = null;
    let browser: Browser | null = null;

    try {
      // 1. Generate TTS audio upfront (before any server/browser work)
      console.log(`Generating TTS for: "${userText}"`);
      const speechPcm = await generateTtsAudio(userText);
      const resampled = resample(speechPcm);
      const audioBase64 = encodeBase64(resampled);
      const durationSec = (speechPcm.length / 2 / TTS_SAMPLE_RATE).toFixed(1);
      console.log(
        `  ${speechPcm.length} bytes @ ${TTS_SAMPLE_RATE}Hz → ${resampled.length} bytes @ ${STT_SAMPLE_RATE}Hz (${durationSec}s)\n`,
      );

      // 2. Load and bundle agent
      console.log("Loading agent...");
      const agentDir = resolve("examples/math-buddy");
      const agent = await loadAgent(agentDir);
      if (!agent) throw new Error("Agent not found in " + agentDir);

      console.log(`Bundling ${agent.slug}...`);
      const slugDir = `${tmpDir}/${agent.slug}`;
      await bundleAgent(agent, slugDir);

      // 3. Start orchestrator
      console.log(`Starting server on port ${port}...`);
      orchestrator = spawn(port);
      await waitForServer(baseUrl);

      // 4. Deploy agent
      console.log("Deploying agent...");
      await deployToLocal(
        baseUrl,
        slugDir,
        agent.slug,
        agent.env,
        agent.transport,
      );
      const agentUrl = `${baseUrl}/websocket/${agent.slug}/`;
      console.log(`Agent live at ${agentUrl}\n`);

      // 5. Launch headless browser
      console.log("Launching headless browser...");
      browser = await launch({ headless: true });
      const page = await browser.newPage();

      // 6. Navigate to agent page
      console.log(`Navigating to ${agentUrl}`);
      await page.goto(agentUrl, { waitUntil: "networkidle0" });

      // 7. Monkey-patch WebSocket and getUserMedia BEFORE clicking Start
      console.log("Installing WebSocket interceptor...");
      await page.evaluate(() => {
        const g = globalThis as unknown as Record<string, unknown>;
        g.__wsLog = [] as string[];
        g.__capturedWs = null;
        g.__wsReady = false;

        const OrigWS = WebSocket;
        // deno-lint-ignore no-explicit-any
        (globalThis as any).WebSocket = class extends OrigWS {
          constructor(url: string | URL, protocols?: string | string[]) {
            super(url, protocols);
            g.__capturedWs = this;
            (g.__wsLog as string[]).push("ws:created:" + url);

            this.addEventListener("message", (event) => {
              if (typeof event.data === "string") {
                try {
                  const msg = JSON.parse(event.data);
                  (g.__wsLog as string[]).push("ws:recv:" + msg.type);
                  if (msg.type === "ready") {
                    g.__wsReady = true;
                  }
                } catch { /* binary or invalid */ }
              }
            });
          }
        };

        // Fake getUserMedia with silence so audio setup works without a real mic
        navigator.mediaDevices.getUserMedia = () => {
          (g.__wsLog as string[]).push("getUserMedia:faked");
          const ctx = new AudioContext({ sampleRate: 16000 });
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          gain.gain.value = 0;
          const dest = ctx.createMediaStreamDestination();
          osc.connect(gain);
          gain.connect(dest);
          osc.start();
          return Promise.resolve(dest.stream);
        };
      });

      // 8. Click "Start Conversation"
      console.log('Clicking "Start Conversation"...');
      const startBtn = await page.waitForSelector("button");
      await startBtn.click();

      // 9. Wait for WebSocket "ready" message
      console.log("Waiting for WebSocket ready...");
      await pollPage(
        page,
        () =>
          (globalThis as unknown as Record<string, unknown>).__wsReady === true,
        10_000,
        "WebSocket ready",
      );

      // 10. Send audio_ready to trigger greeting
      console.log("Sending audio_ready...");
      await page.evaluate(() => {
        const ws = (globalThis as unknown as Record<string, unknown>)
          .__capturedWs as WebSocket;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "audio_ready" }));
          ((globalThis as unknown as Record<string, unknown>)
            .__wsLog as string[])
            .push("sent:audio_ready");
        }
      });

      // 11. Wait for greeting (chat message from assistant)
      console.log("Waiting for greeting...");
      await pollPage(
        page,
        () => {
          const els = document.querySelectorAll("[class*='go'] .content");
          return els.length >= 1;
        },
        15_000,
        "greeting to appear",
      );
      console.log("  Greeting received\n");

      // 11b. Wait for greeting TTS to finish (server mutes mic during TTS)
      console.log("Waiting for greeting TTS to finish...");
      await pollPage(
        page,
        () => {
          const log = (globalThis as unknown as Record<string, unknown>)
            .__wsLog as string[];
          return log.some((e: string) => e === "ws:recv:tts_done");
        },
        20_000,
        "greeting TTS done",
      );
      console.log("  TTS done, mic unmuted\n");

      // 12. Inject TTS audio frames through the WebSocket
      console.log("Injecting audio frames...");
      await page.evaluate((b64: string) => {
        const g = globalThis as unknown as Record<string, unknown>;
        const ws = g.__capturedWs as WebSocket;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        g.__audioSendDone = false;

        // Decode base64 to binary
        const raw = atob(b64);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

        // Send in chunks (~100ms of audio at 16kHz 16-bit mono = 3200 bytes)
        const chunkSize = 3200;
        let offset = 0;
        const sendChunk = () => {
          if (offset >= bytes.length || ws.readyState !== WebSocket.OPEN) {
            (g.__wsLog as string[]).push(
              `sent:audio:${bytes.length}bytes`,
            );
            g.__audioSendDone = true;
            return;
          }
          const end = Math.min(offset + chunkSize, bytes.length);
          ws.send(bytes.slice(offset, end).buffer);
          offset = end;
          setTimeout(sendChunk, 50);
        };
        sendChunk();
      }, { args: [audioBase64] });

      // Wait for all audio chunks to be sent
      await pollPage(
        page,
        () =>
          (globalThis as unknown as Record<string, unknown>).__audioSendDone ===
            true,
        5_000,
        "audio send complete",
      );

      // 13. Wait for user turn to be recognized
      console.log("Waiting for speech recognition...");
      await pollPage(
        page,
        () => {
          const users = document.querySelectorAll(".user:not(.transcript)");
          return users.length >= 1;
        },
        20_000,
        "speech recognition",
      );

      const recognized = await page.evaluate(() => {
        const els = document.querySelectorAll(".user:not(.transcript)");
        return els[els.length - 1]?.textContent?.trim() ?? "";
      });
      console.log(`  Recognized: "${recognized}"\n`);

      // 14. Wait for agent response
      console.log("Waiting for agent response...");
      await pollPage(
        page,
        () => {
          const bubbles = document.querySelectorAll("[class*='go'] .content");
          // Need at least: greeting + user turn + response = 3 bubbles
          return bubbles.length >= 3;
        },
        20_000,
        "agent response",
      );

      // 15. Extract conversation — find bubbles that have a .content child
      const messages = await page.evaluate(() => {
        const results: { role: string; text: string }[] = [];
        const seen = new Set<string>();
        for (const content of document.querySelectorAll(".content")) {
          const bubble = content.parentElement;
          if (!bubble || bubble.classList.contains("transcript")) continue;
          const text = content.textContent?.trim() ?? "";
          if (!text || seen.has(text)) continue;
          seen.add(text);
          const role = bubble.classList.contains("user") ? "user" : "assistant";
          results.push({ role, text });
        }
        return results;
      });

      console.log("--- Conversation ---");
      for (const msg of messages) {
        const prefix = msg.role === "user" ? "User" : "Agent";
        console.log(`${prefix}: ${msg.text}`);
      }
      console.log("---\n");

      // 16. Screenshot
      const screenshot = await page.screenshot();
      const screenshotPath = `${tmpDir}/screenshot.png`;
      await Deno.writeFile(screenshotPath, screenshot);
      console.log(`Screenshot: ${screenshotPath}`);

      console.log("\nE2E test passed!");
    } finally {
      if (browser) await browser.close().catch(() => {});
      if (orchestrator) {
        try {
          orchestrator.kill("SIGKILL");
        } catch { /* already dead */ }
      }
      await stopEsbuild();
      await Deno.remove(tmpDir, { recursive: true }).catch(() => {});
    }
  },
});

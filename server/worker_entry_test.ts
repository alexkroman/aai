import { z } from "zod";
import { expect } from "@std/expect";
import type { AgentDef, ToolDef } from "@aai/sdk/types";
import { DEFAULT_GREETING, DEFAULT_INSTRUCTIONS } from "@aai/sdk/types";
import { startWorker, type WorkerApi } from "@aai/core/worker-entry";
import { createRpcCaller } from "@aai/core/rpc";

function makeAgent(tools: Record<string, ToolDef>): AgentDef {
  return {
    name: "test",
    env: [],
    transport: ["websocket"],
    instructions: DEFAULT_INSTRUCTIONS,
    greeting: DEFAULT_GREETING,
    voice: "luna",
    tools,
  };
}

function createHarness(
  agent: AgentDef,
  env: Record<string, string> = {},
) {
  const channel = new MessageChannel();
  startWorker(agent, env, channel.port1);
  const call = createRpcCaller(channel.port2);
  const workerApi: WorkerApi = {
    async executeTool(name, args, sessionId, timeoutMs) {
      const raw = await call(
        "executeTool",
        { name, args, sessionId },
        timeoutMs,
      );
      return typeof raw === "string" ? raw : String(raw ?? "");
    },
    async invokeHook(hook, sessionId, extra, timeoutMs) {
      await call("invokeHook", { hook, sessionId, ...extra }, timeoutMs);
    },
  };

  return {
    workerApi,
    close() {
      channel.port1.close();
      channel.port2.close();
    },
  };
}

Deno.test("executeTool runs handler through worker RPC", async () => {
  const h = createHarness(makeAgent({
    greet: {
      description: "Greet",
      parameters: z.object({ name: z.string() }),
      execute: ({ name }) => `Hello, ${name}!`,
    },
  }));
  try {
    expect(
      await h.workerApi.executeTool("greet", { name: "World" }),
    ).toBe("Hello, World!");
  } finally {
    h.close();
  }
});

Deno.test("executeTool returns error string for unknown tool", async () => {
  const h = createHarness(makeAgent({}));
  try {
    expect(
      await h.workerApi.executeTool("nope", {}),
    ).toContain("Unknown tool");
  } finally {
    h.close();
  }
});

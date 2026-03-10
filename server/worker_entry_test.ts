import { z } from "zod";
import { expect } from "@std/expect";
import type { AgentDef, ToolDef } from "@aai/sdk/types";
import { DEFAULT_GREETING, DEFAULT_INSTRUCTIONS } from "@aai/sdk/types";
import {
  createWorkerApi,
  startWorker,
  type WorkerApi,
} from "@aai/core/worker-entry";

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
  _env: Record<string, string> = {},
) {
  const channel = new MessageChannel();
  startWorker(agent, _env, channel.port1);
  const workerApi: WorkerApi = createWorkerApi(channel.port2);

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

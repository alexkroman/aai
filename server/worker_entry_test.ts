import { z } from "zod";
import { expect } from "@std/expect";
import type { ToolDef } from "../sdk/types.ts";
import { startWorker } from "../core/_worker_entry.ts";
import { createWorkerRpc } from "./rpc.ts";

function createHarness(
  agent: {
    tools: Record<string, ToolDef>;
  },
  env: Record<string, string> = {},
) {
  const channel = new MessageChannel();
  startWorker(agent, env, channel.port1);
  const workerApi = createWorkerRpc(channel.port2);

  return {
    workerApi,
    close() {
      channel.port1.close();
      channel.port2.close();
    },
  };
}

Deno.test("executeTool runs handler through worker RPC", async () => {
  const h = createHarness({
    tools: {
      greet: {
        description: "Greet",
        parameters: z.object({ name: z.string() }),
        execute: ({ name }) => `Hello, ${name}!`,
      },
    },
  });
  try {
    expect(
      await h.workerApi.executeTool("greet", { name: "World" }),
    ).toBe("Hello, World!");
  } finally {
    h.close();
  }
});

Deno.test("executeTool returns error string for unknown tool", async () => {
  const h = createHarness({ tools: {} });
  try {
    expect(
      await h.workerApi.executeTool("nope", {}),
    ).toContain("Unknown tool");
  } finally {
    h.close();
  }
});

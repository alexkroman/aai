import { expect } from "@std/expect";
import { AgentMetadataSchema } from "./_rpc_schema.ts";

Deno.test("AgentMetadataSchema", async (t) => {
  await t.step("accepts minimal metadata", () => {
    const result = AgentMetadataSchema.safeParse({ slug: "test" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.env).toEqual({});
      expect(result.data.transport).toEqual(["websocket"]);
    }
  });

  await t.step("accepts full metadata", () => {
    const result = AgentMetadataSchema.safeParse({
      slug: "my-agent",
      env: { KEY: "val" },
      transport: ["websocket", "twilio"],
      owner_hash: "abc123",
      config: {
        instructions: "Help",
        greeting: "Hi",
        voice: "luna",
      },
      toolSchemas: [
        { name: "greet", description: "Say hi", parameters: {} },
      ],
    });
    expect(result.success).toBe(true);
  });

  await t.step("rejects missing slug", () => {
    const result = AgentMetadataSchema.safeParse({ env: {} });
    expect(result.success).toBe(false);
  });
});

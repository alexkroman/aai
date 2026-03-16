// Copyright 2025 the AAI authors. MIT license.
import { assertEquals } from "@std/assert";
import { z } from "zod";
import { executeToolCall, TOOL_HANDLER_TIMEOUT } from "./worker_entry.ts";
import type { ToolDef } from "@aai/sdk/types";

function makeTool(overrides?: Partial<ToolDef>): ToolDef {
  return {
    description: "test tool",
    execute: () => "ok",
    ...overrides,
  };
}

Deno.test("executeToolCall", async (t) => {
  await t.step("returns string result from tool", async () => {
    const tool = makeTool({ execute: () => "hello" });
    const result = await executeToolCall("test", {}, {
      tool,
      env: {},
    });
    assertEquals(result, "hello");
  });

  await t.step("serializes non-string result as JSON", async () => {
    const tool = makeTool({ execute: () => ({ count: 42 }) });
    const result = await executeToolCall("test", {}, {
      tool,
      env: {},
    });
    assertEquals(result, '{"count":42}');
  });

  await t.step("returns 'null' for null/undefined result", async () => {
    const tool = makeTool({ execute: () => null });
    const result = await executeToolCall("test", {}, {
      tool,
      env: {},
    });
    assertEquals(result, "null");
  });

  await t.step("validates args against parameter schema", async () => {
    const tool = makeTool({
      parameters: z.object({ name: z.string() }),
      execute: (args) => `hi ${(args as { name: string }).name}`,
    });
    const result = await executeToolCall("greet", { name: "alice" }, {
      tool,
      env: {},
    });
    assertEquals(result, "hi alice");
  });

  await t.step("returns error for invalid args", async () => {
    const tool = makeTool({
      parameters: z.object({ name: z.string() }),
      execute: () => "ok",
    });
    const result = await executeToolCall("greet", { name: 123 }, {
      tool,
      env: {},
    });
    assertEquals(result.startsWith("Error: Invalid arguments"), true);
    assertEquals(result.includes("greet"), true);
  });

  await t.step("returns error when tool throws", async () => {
    const tool = makeTool({
      execute: () => {
        throw new Error("boom");
      },
    });
    const result = await executeToolCall("fail", {}, {
      tool,
      env: {},
    });
    assertEquals(result, "Error: boom");
  });

  await t.step("returns error for non-Error throw", async () => {
    const tool = makeTool({
      execute: () => {
        throw "string error";
      },
    });
    const result = await executeToolCall("fail", {}, {
      tool,
      env: {},
    });
    assertEquals(result, "Error: string error");
  });

  await t.step("passes env to tool context", async () => {
    const tool = makeTool({
      execute: (_args, ctx) => ctx.env["API_KEY"] ?? "missing",
    });
    const result = await executeToolCall("test", {}, {
      tool,
      env: { API_KEY: "secret" },
    });
    assertEquals(result, "secret");
  });

  await t.step("passes sessionId to tool context", async () => {
    const tool = makeTool({
      execute: (_args, ctx) => ctx.sessionId,
    });
    const result = await executeToolCall("test", {}, {
      tool,
      env: {},
      sessionId: "sess-123",
    });
    assertEquals(result, "sess-123");
  });

  await t.step("defaults sessionId to empty string", async () => {
    const tool = makeTool({
      execute: (_args, ctx) => ctx.sessionId,
    });
    const result = await executeToolCall("test", {}, {
      tool,
      env: {},
    });
    assertEquals(result, "");
  });

  await t.step("passes messages to tool context", async () => {
    const messages = [{ role: "user" as const, content: "hi" }];
    const tool = makeTool({
      execute: (_args, ctx) => String(ctx.messages.length),
    });
    const result = await executeToolCall("test", {}, {
      tool,
      env: {},
      messages,
    });
    assertEquals(result, "1");
  });

  await t.step("kv throws when not provided", async () => {
    const tool = makeTool({
      execute: (_args, ctx) => {
        // accessing ctx.kv should throw
        try {
          void ctx.kv;
          return "no error";
        } catch (e) {
          return (e as Error).message;
        }
      },
    });
    const result = await executeToolCall("test", {}, {
      tool,
      env: {},
    });
    assertEquals(result, "KV not available");
  });

  await t.step("provides abortSignal in context", async () => {
    const tool = makeTool({
      execute: (_args, ctx) => String(ctx.abortSignal instanceof AbortSignal),
    });
    const result = await executeToolCall("test", {}, {
      tool,
      env: {},
    });
    assertEquals(result, "true");
  });

  await t.step("handles async tool execution", async () => {
    const tool = makeTool({
      execute: async () => {
        await new Promise((r) => setTimeout(r, 10));
        return "async result";
      },
    });
    const result = await executeToolCall("test", {}, {
      tool,
      env: {},
    });
    assertEquals(result, "async result");
  });

  await t.step("TOOL_HANDLER_TIMEOUT is 30 seconds", () => {
    assertEquals(TOOL_HANDLER_TIMEOUT, 30_000);
  });
});

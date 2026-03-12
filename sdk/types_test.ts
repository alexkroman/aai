// Copyright 2025 the AAI authors. MIT license.
import { z } from "zod";
import { assertStrictEquals } from "@std/assert";
import { agentToolsToSchemas, type ToolDef } from "./types.ts";

Deno.test("agentToolsToSchemas - converts tool definitions to OpenAI schema", () => {
  const tools: Record<string, ToolDef> = {
    "get_weather": {
      description: "Get weather",
      parameters: z.object({
        city: z.string().describe("City"),
      }),
      execute: async () => {},
    },
    "set_alarm": {
      description: "Set alarm",
      parameters: z.object({
        time: z.string(),
        label: z.string().optional(),
      }),
      execute: async () => {},
    },
  };
  const schemas = agentToolsToSchemas(tools);
  assertStrictEquals(schemas.length, 2);
  assertStrictEquals(schemas[0]!.name, "get_weather");
  assertStrictEquals(schemas[0]!.description, "Get weather");
  assertStrictEquals(schemas[1]!.name, "set_alarm");
});

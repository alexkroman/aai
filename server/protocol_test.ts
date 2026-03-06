import { expect } from "@std/expect";
import { agentToolsToSchemas, type ToolDef } from "./agent_types.ts";

Deno.test("agentToolsToSchemas - converts tool definitions to OpenAI schema", () => {
  const tools: Record<string, ToolDef> = {
    get_weather: {
      description: "Get weather",
      parameters: {
        type: "object",
        properties: { city: { type: "string", description: "City" } },
        required: ["city"],
      },
      execute: async () => {},
    },
    set_alarm: {
      description: "Set alarm",
      parameters: {
        type: "object",
        properties: {
          time: { type: "string" },
          label: { type: "string" },
        },
        required: ["time"],
      },
      execute: async () => {},
    },
  };
  const schemas = agentToolsToSchemas(tools);
  expect(schemas.length).toBe(2);
  expect(schemas[0].name).toBe("get_weather");
  expect(schemas[0].description).toBe("Get weather");
  expect(
    (schemas[0].parameters as Record<string, unknown>).type,
  ).toBe("object");
  expect(schemas[1].name).toBe("set_alarm");
});

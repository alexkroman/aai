import { expect } from "@std/expect";
import { executeBuiltinTool, getBuiltinToolSchemas } from "./builtin_tools.ts";

// --- getBuiltinToolSchemas ---

Deno.test("getBuiltinToolSchemas returns requested + required tools", () => {
  const schemas = getBuiltinToolSchemas([
    "web_search",
    "visit_webpage",
    "run_code",
    "fetch_json",
  ]);
  expect(schemas).toHaveLength(6);
  const names = schemas.map((s) => s.name);
  expect(names).toContain("final_answer");
  expect(names).toContain("user_input");
  expect(names).toContain("web_search");
});

Deno.test("getBuiltinToolSchemas ignores unknown tool names", () => {
  const schemas = getBuiltinToolSchemas(["unknown_tool", "web_search"]);
  expect(schemas).toHaveLength(3);
});

Deno.test("getBuiltinToolSchemas always includes required tools", () => {
  const schemas = getBuiltinToolSchemas([]);
  expect(schemas).toHaveLength(2);
  const names = schemas.map((s) => s.name);
  expect(names).toContain("final_answer");
  expect(names).toContain("user_input");
});

Deno.test("getBuiltinToolSchemas does not duplicate final_answer", () => {
  const schemas = getBuiltinToolSchemas(["final_answer", "web_search"]);
  const names = schemas.map((s) => s.name);
  expect(names.filter((n) => n === "final_answer")).toHaveLength(1);
});

Deno.test("getBuiltinToolSchemas returns schemas with correct shape", () => {
  const schemas = getBuiltinToolSchemas(["web_search"]);
  const webSearch = schemas.find((s) => s.name === "web_search")!;
  expect(typeof webSearch.description).toBe("string");
  expect(webSearch.parameters).toBeDefined();
});

// --- executeBuiltinTool ---

Deno.test("executeBuiltinTool returns null for unknown tool", async () => {
  const result = await executeBuiltinTool("nonexistent", {});
  expect(result).toBeNull();
});

Deno.test("executeBuiltinTool returns error for invalid args", async () => {
  const result = await executeBuiltinTool("web_search", {});
  expect(result).not.toBeNull();
  expect(result!).toContain("Error");
});

Deno.test("executeBuiltinTool passes Zod-parsed data to execute", async () => {
  const mockFetch = (() =>
    Promise.resolve(
      new Response("<html><body>OK</body></html>", { status: 200 }),
    )) as typeof globalThis.fetch;

  const result = await executeBuiltinTool(
    "visit_webpage",
    { url: "https://example.com" },
    {},
    mockFetch,
  );
  expect(result).not.toBeNull();
  const parsed = JSON.parse(result!);
  expect(parsed.url).toBe("https://example.com");
});

Deno.test("visit_webpage fetches and converts HTML", async () => {
  const mockFetch = (() =>
    Promise.resolve(
      new Response("<html><body><p>Hello World</p></body></html>", {
        status: 200,
      }),
    )) as typeof globalThis.fetch;

  const result = await executeBuiltinTool(
    "visit_webpage",
    { url: "https://example.com" },
    {},
    mockFetch,
  );
  const parsed = JSON.parse(result!);
  expect(parsed.content).toContain("Hello World");
});

Deno.test("visit_webpage handles non-OK response", async () => {
  const mockFetch = (() =>
    Promise.resolve(
      new Response("Not Found", { status: 404, statusText: "Not Found" }),
    )) as typeof globalThis.fetch;

  const result = await executeBuiltinTool(
    "visit_webpage",
    { url: "https://example.com/missing" },
    {},
    mockFetch,
  );
  const parsed = JSON.parse(result!);
  expect(parsed.error).toContain("404");
});

Deno.test("run_code executes and returns stdout", async () => {
  const result = await executeBuiltinTool("run_code", {
    code: 'console.log("hello")',
  });
  expect(result).toBe("hello");
});

Deno.test("run_code returns error for syntax errors", async () => {
  const result = await executeBuiltinTool("run_code", {
    code: "this is not valid javascript %%%",
  });
  const parsed = JSON.parse(result!);
  expect(parsed.error).toBeDefined();
});

Deno.test("run_code returns no-output message for silent code", async () => {
  const result = await executeBuiltinTool("run_code", {
    code: "const x = 1 + 1;",
  });
  expect(result).toBe("Code ran successfully (no output)");
});

Deno.test("user_input returns error (handled by turn handler)", async () => {
  const result = await executeBuiltinTool("user_input", {
    question: "What color?",
  });
  expect(result!).toContain("handled by the turn handler");
});

Deno.test("fetch_json fetches and returns JSON", async () => {
  const mockFetch = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ name: "test", value: 42 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )) as typeof globalThis.fetch;

  const result = await executeBuiltinTool(
    "fetch_json",
    { url: "https://api.example.com/data" },
    {},
    mockFetch,
  );
  const parsed = JSON.parse(result!);
  expect(parsed.name).toBe("test");
  expect(parsed.value).toBe(42);
});

Deno.test("fetch_json handles non-OK response", async () => {
  const mockFetch = (() =>
    Promise.resolve(
      new Response("Server Error", { status: 500, statusText: "ISE" }),
    )) as typeof globalThis.fetch;

  const result = await executeBuiltinTool(
    "fetch_json",
    { url: "https://api.example.com/fail" },
    {},
    mockFetch,
  );
  const parsed = JSON.parse(result!);
  expect(parsed.error).toContain("500");
});

Deno.test("fetch_json handles non-JSON response", async () => {
  const mockFetch = (() =>
    Promise.resolve(
      new Response("this is not json", { status: 200 }),
    )) as typeof globalThis.fetch;

  const result = await executeBuiltinTool(
    "fetch_json",
    { url: "https://api.example.com/text" },
    {},
    mockFetch,
  );
  const parsed = JSON.parse(result!);
  expect(parsed.error).toContain("not valid JSON");
});

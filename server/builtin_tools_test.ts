import { expect } from "@std/expect";
import { stub } from "@std/testing/mock";
import {
  _internals,
  executeBuiltinTool,
  getBuiltinS2sToolSchemas,
} from "./builtin_tools.ts";

// --- htmlToMarkdown ---

const HTML_TO_MD_CASES: [string, string, string][] = [
  [
    "strips script and style tags",
    '<p>Hello</p><script>alert("x")</script><style>.a{}</style><p>World</p>',
    "Hello",
  ],
  ["converts headings", "<h1>Title</h1>", "# Title"],
  ["converts h2", "<h2>Sub</h2>", "## Sub"],
  ["converts h3", "<h3>Deep</h3>", "### Deep"],
  ["converts bold", "<b>bold</b>", "**bold**"],
  ["converts strong", "<strong>bold</strong>", "**bold**"],
  ["converts italic", "<i>italic</i>", "_italic_"],
  ["converts em", "<em>italic</em>", "_italic_"],
  [
    "converts links",
    '<a href="https://example.com">click</a>',
    "[click](https://example.com)",
  ],
  ["converts list items", "<ul><li>one</li><li>two</li></ul>", "*   one"],
  ["decodes HTML entities", "<p>&amp; &lt; &gt; &quot;</p>", '& < > "'],
  ["strips remaining tags", "<div><span>text</span></div>", "text"],
  [
    "strips head section",
    "<head><title>T</title></head><body>content</body>",
    "content",
  ],
];

for (const [name, input, expected] of HTML_TO_MD_CASES) {
  Deno.test(`htmlToMarkdown: ${name}`, () => {
    expect(_internals.htmlToMarkdown(input)).toContain(expected);
  });
}

// --- helpers ---

function mockFetch(body: string, status = 200, statusText = "OK") {
  return (() =>
    Promise.resolve(
      new Response(body, { status, statusText }),
    )) as typeof globalThis.fetch;
}

// --- getBuiltinS2sToolSchemas ---

Deno.test("getBuiltinS2sToolSchemas returns requested tools", () => {
  const schemas = getBuiltinS2sToolSchemas([
    "web_search",
    "visit_webpage",
    "run_code",
    "fetch_json",
  ]);
  expect(schemas).toHaveLength(4);
  const names = schemas.map((s) => s.name);
  expect(names).toContain("web_search");
  expect(names).toContain("visit_webpage");
  expect(names).toContain("run_code");
  expect(names).toContain("fetch_json");
});

Deno.test("getBuiltinS2sToolSchemas returns empty for no tools", () => {
  const schemas = getBuiltinS2sToolSchemas([]);
  expect(schemas).toHaveLength(0);
});

Deno.test("getBuiltinS2sToolSchemas includes type: function", () => {
  const schemas = getBuiltinS2sToolSchemas(["web_search"]);
  expect(schemas[0].type).toBe("function");
});

Deno.test("getBuiltinS2sToolSchemas skips unknown tools", () => {
  const schemas = getBuiltinS2sToolSchemas([
    "web_search",
    "final_answer" as never,
  ]);
  expect(schemas).toHaveLength(1);
  expect(schemas[0].name).toBe("web_search");
});

// --- executeBuiltinTool ---

Deno.test("visit_webpage fetches and converts HTML", async () => {
  using _ = stub(
    _internals,
    "fetch",
    mockFetch("<html><body><p>Hello World</p></body></html>"),
  );
  const result = await executeBuiltinTool(
    "visit_webpage",
    { url: "https://example.com" },
    {},
  );
  const parsed = JSON.parse(result);
  expect(parsed.content).toContain("Hello World");
});

Deno.test("visit_webpage handles non-OK response", async () => {
  using _ = stub(
    _internals,
    "fetch",
    mockFetch("Not Found", 404, "Not Found"),
  );
  const result = await executeBuiltinTool(
    "visit_webpage",
    { url: "https://example.com/missing" },
    {},
  );
  const parsed = JSON.parse(result);
  expect(parsed.error).toContain("404");
});

Deno.test("run_code executes and returns stdout", async () => {
  const result = await executeBuiltinTool(
    "run_code",
    { code: 'console.log("hello")' },
    {},
  );
  expect(result).toBe("hello");
});

Deno.test("run_code returns error for syntax errors", async () => {
  const result = await executeBuiltinTool(
    "run_code",
    { code: "this is not valid javascript %%%" },
    {},
  );
  const parsed = JSON.parse(result);
  expect(parsed.error).toBeDefined();
});

Deno.test("run_code returns no-output message for silent code", async () => {
  const result = await executeBuiltinTool(
    "run_code",
    { code: "const x = 1 + 1;" },
    {},
  );
  expect(result).toBe("Code ran successfully (no output)");
});

Deno.test("fetch_json fetches and returns JSON", async () => {
  using _ = stub(
    _internals,
    "fetch",
    mockFetch(JSON.stringify({ name: "test", value: 42 })),
  );
  const result = await executeBuiltinTool(
    "fetch_json",
    { url: "https://api.example.com/data" },
    {},
  );
  const parsed = JSON.parse(result);
  expect(parsed.name).toBe("test");
  expect(parsed.value).toBe(42);
});

Deno.test("fetch_json handles non-OK response", async () => {
  using _ = stub(
    _internals,
    "fetch",
    mockFetch("Server Error", 500, "ISE"),
  );
  const result = await executeBuiltinTool(
    "fetch_json",
    { url: "https://api.example.com/fail" },
    {},
  );
  const parsed = JSON.parse(result);
  expect(parsed.error).toContain("500");
});

Deno.test("fetch_json handles non-JSON response", async () => {
  using _ = stub(
    _internals,
    "fetch",
    mockFetch("this is not json"),
  );
  const result = await executeBuiltinTool(
    "fetch_json",
    { url: "https://api.example.com/text" },
    {},
  );
  const parsed = JSON.parse(result);
  expect(parsed.error).toContain("not valid JSON");
});

Deno.test("executeBuiltinTool returns error for unknown tool", async () => {
  const result = await executeBuiltinTool("nonexistent", {}, {});
  const parsed = JSON.parse(result);
  expect(parsed.error).toContain("Unknown builtin tool");
});

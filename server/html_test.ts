// Copyright 2025 the AAI authors. MIT license.
import { assert, assertStringIncludes } from "@std/assert";
import { renderAgentPage } from "./html.ts";

Deno.test("renderAgentPage escapes HTML in agent name", () => {
  const html = renderAgentPage('<script>alert("xss")</script>');
  assert(!html.includes("<script>alert"));
});

Deno.test("renderAgentPage includes basePath in script src", () => {
  const html = renderAgentPage("Test", "/ns/agent");
  assertStringIncludes(html, 'src="/ns/agent/client.js"');
});

Deno.test("renderAgentPage injects __AAI_BASE__ with basePath", () => {
  const html = renderAgentPage("Test", "/ns/agent");
  assertStringIncludes(html, 'window.__AAI_BASE__="/ns/agent"');
});

Deno.test("renderAgentPage escapes basePath in __AAI_BASE__", () => {
  const html = renderAgentPage("Test", '/ns/"><script>xss');
  assert(!html.includes("<script>xss"));
});

Deno.test("renderAgentPage injects __AAI_WS__ path", () => {
  const html = renderAgentPage("Test", "/ns/agent");
  assertStringIncludes(html, 'window.__AAI_WS__="/ns/agent/websocket"');
});

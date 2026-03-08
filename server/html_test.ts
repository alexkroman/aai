import { expect } from "@std/expect";
import {
  handleFavicon,
  htmlToMarkdown,
  renderAgentPage,
  renderLandingPage,
} from "./html.ts";

Deno.test("htmlToMarkdown", async (t) => {
  await t.step("strips script and style tags", () => {
    const html =
      '<p>Hello</p><script>alert("x")</script><style>.a{}</style><p>World</p>';
    const result = htmlToMarkdown(html);
    expect(result).toContain("Hello");
    expect(result).toContain("World");
    expect(result).not.toContain("alert");
    expect(result).not.toContain(".a{}");
  });

  await t.step("converts headings", () => {
    expect(htmlToMarkdown("<h1>Title</h1>")).toBe("# Title");
    expect(htmlToMarkdown("<h2>Sub</h2>")).toBe("## Sub");
    expect(htmlToMarkdown("<h3>Deep</h3>")).toBe("### Deep");
  });

  await t.step("converts bold and italic", () => {
    expect(htmlToMarkdown("<b>bold</b>")).toBe("**bold**");
    expect(htmlToMarkdown("<strong>bold</strong>")).toBe("**bold**");
    expect(htmlToMarkdown("<i>italic</i>")).toBe("_italic_");
    expect(htmlToMarkdown("<em>italic</em>")).toBe("_italic_");
  });

  await t.step("converts links", () => {
    const html = '<a href="https://example.com">click</a>';
    expect(htmlToMarkdown(html)).toBe("[click](https://example.com)");
  });

  await t.step("converts list items", () => {
    const html = "<ul><li>one</li><li>two</li></ul>";
    expect(htmlToMarkdown(html)).toBe("* one\n* two");
  });

  await t.step("decodes HTML entities", () => {
    expect(htmlToMarkdown("&amp; &lt; &gt; &quot;")).toBe('& < > "');
    expect(htmlToMarkdown("&#65;")).toBe("A");
    expect(htmlToMarkdown("&#x41;")).toBe("A");
  });

  await t.step("strips remaining tags", () => {
    expect(htmlToMarkdown("<div><span>text</span></div>")).toBe("text");
  });

  await t.step("collapses multiple blank lines", () => {
    expect(htmlToMarkdown("a\n\n\n\nb")).toBe("a\n\nb");
  });

  await t.step("strips head section", () => {
    const html = "<head><title>T</title></head><body>content</body>";
    expect(htmlToMarkdown(html)).toBe("content");
  });
});

Deno.test("handleFavicon", async (t) => {
  await t.step("returns SVG with correct content type", () => {
    const res = handleFavicon();
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(res.headers.get("Cache-Control")).toContain("max-age=86400");
  });
});

Deno.test("renderLandingPage", async (t) => {
  await t.step("returns valid HTML with title", () => {
    const html = renderLandingPage();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>aai</title>");
    expect(html).toContain("curl");
  });
});

Deno.test("renderAgentPage", async (t) => {
  await t.step("includes escaped agent name in title", () => {
    const html = renderAgentPage("My Agent");
    expect(html).toContain("<title>My Agent</title>");
    expect(html).toContain('id="app"');
  });

  await t.step("escapes HTML in agent name", () => {
    const html = renderAgentPage('<script>alert("xss")</script>');
    expect(html).not.toContain("<script>alert");
  });

  await t.step("includes basePath in script src", () => {
    const html = renderAgentPage("Test", "/ns/agent");
    expect(html).toContain('src="/ns/agent/client.js"');
  });
});

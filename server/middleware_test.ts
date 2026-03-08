import { expect } from "@std/expect";
import { withMiddleware } from "./middleware.ts";

function makeReq(method = "GET"): Request {
  return new Request("http://localhost/test", { method });
}

Deno.test("withMiddleware", async (t) => {
  await t.step("adds CORS headers", async () => {
    const handler = withMiddleware(() => new Response("ok"));
    const res = await handler(makeReq());
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain(
      "Content-Type",
    );
  });

  await t.step("adds Cross-Origin-Isolation headers", async () => {
    const handler = withMiddleware(() => new Response("ok"));
    const res = await handler(makeReq());
    expect(res.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(res.headers.get("Cross-Origin-Embedder-Policy")).toBe(
      "credentialless",
    );
  });

  await t.step("returns 204 for OPTIONS preflight", async () => {
    const handler = withMiddleware(() => new Response("ok"));
    const res = await handler(makeReq("OPTIONS"));
    expect(res.status).toBe(204);
  });

  await t.step("preserves original status and body", async () => {
    const handler = withMiddleware(
      () => new Response("created", { status: 201 }),
    );
    const res = await handler(makeReq());
    expect(res.status).toBe(201);
    expect(await res.text()).toBe("created");
  });

  await t.step("preserves original response headers", async () => {
    const handler = withMiddleware(
      () => new Response("ok", { headers: { "X-Custom": "val" } }),
    );
    const res = await handler(makeReq());
    expect(res.headers.get("X-Custom")).toBe("val");
  });

  await t.step("returns 500 on unhandled error", async () => {
    const handler = withMiddleware(() => {
      throw new Error("boom");
    });
    const res = await handler(makeReq());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Internal server error");
  });
});

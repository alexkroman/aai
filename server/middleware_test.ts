import { expect } from "@std/expect";
import { withMiddleware } from "./middleware.ts";

function makeReq(method = "GET"): Request {
  return new Request("http://localhost/test", { method });
}

Deno.test("withMiddleware adds CORS headers", async () => {
  const handler = withMiddleware(() => new Response("ok"));
  const res = await handler(makeReq());
  expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
});

Deno.test("withMiddleware returns 204 for OPTIONS preflight", async () => {
  const handler = withMiddleware(() => new Response("ok"));
  const res = await handler(makeReq("OPTIONS"));
  expect(res.status).toBe(204);
});

Deno.test("withMiddleware preserves original status and body", async () => {
  const handler = withMiddleware(
    () => new Response("created", { status: 201 }),
  );
  const res = await handler(makeReq());
  expect(res.status).toBe(201);
  expect(await res.text()).toBe("created");
});

Deno.test("withMiddleware returns 500 on unhandled error", async () => {
  const handler = withMiddleware(() => {
    throw new Error("boom");
  });
  const res = await handler(makeReq());
  expect(res.status).toBe(500);
  const body = await res.json();
  expect(body.error).toBe("Internal server error");
});

// Copyright 2025 the AAI authors. MIT license.
import type { AgentSlot } from "./worker_pool.ts";
import type { BundleStore } from "./bundle_store_tigris.ts";
import type { Session } from "./session.ts";
import type { ScopeKey } from "./scope_token.ts";
import type { KvStore } from "./kv.ts";

/** HTTP error with a status code, thrown by handlers and middleware helpers. */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Shared server state passed to all route handlers. */
export type AppState = {
  slots: Map<string, AgentSlot>;
  sessions: Map<string, Session>;
  store: BundleStore;
  scopeKey: ScopeKey;
  kvStore: KvStore;
};

/** Context passed to route handler functions. */
export type RouteContext = {
  req: Request;
  info: Deno.ServeHandlerInfo;
  params: Record<string, string>;
  state: AppState;
};

/** Create a JSON response. */
export function json(
  data: unknown,
  opts?: { status?: number; headers?: Record<string, string> },
): Response {
  return new Response(JSON.stringify(data), {
    status: opts?.status ?? 200,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
}

/** Create an HTML response. */
export function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/** Create a plain text response. */
export function text(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

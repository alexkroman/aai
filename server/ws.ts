/** Deno supports headers in WebSocket constructor at runtime. */
export function createWebSocket(
  url: string,
  headers?: Record<string, string>,
): WebSocket {
  // @ts-expect-error Deno runtime supports { headers } but types say string | string[]
  return new WebSocket(url, headers ? { headers } : undefined);
}

export function safeClose(ws: WebSocket): void {
  try {
    ws.close();
  } catch {
    // ignore
  }
}

export function safeParseJSON(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

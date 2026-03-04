// Worker entry point for sandboxed code execution.
// Spawned with all permissions denied for isolation.

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  if (msg.type !== "execute") {
    self.postMessage({
      id: msg.id,
      error: `Unknown message type: ${msg.type}`,
    });
    return;
  }

  const output: string[] = [];
  const capture = (...args: unknown[]) =>
    output.push(args.map(String).join(" "));

  const fakeConsole = {
    log: capture,
    info: capture,
    warn: capture,
    error: capture,
    debug: capture,
  };

  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {})
      .constructor;
    const fn = new AsyncFunction("console", msg.code);
    await fn(fakeConsole);
    self.postMessage({
      id: msg.id,
      result: { output: output.join("\n") },
    });
  } catch (err: unknown) {
    self.postMessage({
      id: msg.id,
      result: {
        output: output.join("\n"),
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }
};

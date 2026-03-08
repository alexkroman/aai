import { createWorkerApi } from "../core/_worker_entry.ts";

/** Spawn a local Deno Worker from bundled code and return a WorkerApi. */
export function spawnLocalWorker(
  workerCode: string,
  slug: string,
): { workerApi: ReturnType<typeof createWorkerApi>; terminate: () => void } {
  const workerUrl = `data:application/javascript;base64,${btoa(workerCode)}`;

  // deno-lint-ignore no-explicit-any
  const worker = new (Worker as any)(workerUrl, {
    type: "module",
    name: `dev-${slug}`,
    deno: {
      permissions: {
        net: true,
        read: false,
        env: false,
        run: false,
        write: false,
        ffi: false,
        sys: false,
      },
    },
  });

  return {
    workerApi: createWorkerApi(worker),
    terminate: () => worker.terminate(),
  };
}

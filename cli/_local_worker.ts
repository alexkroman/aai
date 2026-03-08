import { encodeBase64 } from "@std/encoding/base64";
import { createWorkerApi } from "../core/_worker_entry.ts";
import { createDenoWorker } from "../core/_deno_worker.ts";

export function spawnLocalWorker(
  workerCode: string,
  slug: string,
): { workerApi: ReturnType<typeof createWorkerApi>; terminate: () => void } {
  const workerUrl = `data:application/javascript;base64,${
    encodeBase64(workerCode)
  }`;

  const worker = createDenoWorker(workerUrl, `dev-${slug}`, {
    net: true,
    read: false,
    env: false,
    run: false,
    write: false,
    ffi: false,
    sys: false,
  });

  return {
    workerApi: createWorkerApi(worker),
    terminate: () => worker.terminate(),
  };
}

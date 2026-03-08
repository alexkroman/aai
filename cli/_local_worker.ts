import { encodeBase64 } from "@std/encoding/base64";
import { createWorkerApi } from "../core/_worker_entry.ts";

export function spawnLocalWorker(
  workerCode: string,
  slug: string,
): { workerApi: ReturnType<typeof createWorkerApi>; terminate: () => void } {
  const workerUrl = `data:application/javascript;base64,${
    encodeBase64(workerCode)
  }`;

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

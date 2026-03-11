import { assertSnapshot } from "@std/testing/snapshot";
import { AudioFrameSpec } from "./_protocol.ts";

Deno.test("AudioFrameSpec snapshot", async (t) => {
  await assertSnapshot(t, AudioFrameSpec);
});

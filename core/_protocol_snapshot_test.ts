import { assertSnapshot } from "@std/testing/snapshot";
import { z } from "zod";
import {
  AudioFrameSpec,
  ClientMessageSchema,
  ServerMessageSchema,
} from "./_protocol.ts";

Deno.test("ServerMessageSchema snapshot", async (t) => {
  await assertSnapshot(t, z.toJSONSchema(ServerMessageSchema));
});

Deno.test("ClientMessageSchema snapshot", async (t) => {
  await assertSnapshot(t, z.toJSONSchema(ClientMessageSchema));
});

Deno.test("AudioFrameSpec snapshot", async (t) => {
  await assertSnapshot(t, AudioFrameSpec);
});

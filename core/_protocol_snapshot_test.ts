import { assertSnapshot } from "@std/testing/snapshot";
import { z } from "zod";
import {
  ClientMessageSchema,
  DevRegisteredSchema,
  DevRegisterSchema,
  ServerMessageSchema,
} from "./_protocol.ts";

Deno.test("DevRegisterSchema snapshot", async (t) => {
  await assertSnapshot(t, z.toJSONSchema(DevRegisterSchema));
});

Deno.test("DevRegisteredSchema snapshot", async (t) => {
  await assertSnapshot(t, z.toJSONSchema(DevRegisteredSchema));
});

Deno.test("ServerMessageSchema snapshot", async (t) => {
  await assertSnapshot(t, z.toJSONSchema(ServerMessageSchema));
});

Deno.test("ClientMessageSchema snapshot", async (t) => {
  await assertSnapshot(t, z.toJSONSchema(ClientMessageSchema));
});

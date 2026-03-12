// Copyright 2025 the AAI authors. MIT license.
import {
  assert,
  assertEquals,
  assertNotStrictEquals,
  assertRejects,
  assertStrictEquals,
} from "@std/assert";
import { decryptEnv, deriveCredentialKey, encryptEnv } from "./credentials.ts";

Deno.test("credentials", async (t) => {
  await t.step("encrypt and decrypt round-trip", async () => {
    const key = await deriveCredentialKey("test-secret");
    const env = { ASSEMBLYAI_API_KEY: "sk-123", MY_SECRET: "hunter2" };
    const jwe = await encryptEnv(key, env);
    assertStrictEquals(typeof jwe, "string");
    assert(!jwe.includes("sk-123"));
    assertEquals(await decryptEnv(key, jwe), env);
  });

  await t.step("different secrets cannot decrypt", async () => {
    const key1 = await deriveCredentialKey("secret-a");
    const key2 = await deriveCredentialKey("secret-b");
    const jwe = await encryptEnv(key1, { KEY: "val" });
    await assertRejects(async () => await decryptEnv(key2, jwe));
  });

  await t.step("empty env round-trips", async () => {
    const key = await deriveCredentialKey("test-secret");
    const jwe = await encryptEnv(key, {});
    assertEquals(await decryptEnv(key, jwe), {});
  });

  await t.step("same input produces different JWEs (unique IVs)", async () => {
    const key = await deriveCredentialKey("test-secret");
    const env = { KEY: "value" };
    const jwe1 = await encryptEnv(key, env);
    const jwe2 = await encryptEnv(key, env);
    assertNotStrictEquals(jwe1, jwe2);
  });
});

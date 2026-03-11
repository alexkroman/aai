import { expect } from "@std/expect";
import {
  importScopeKey,
  ScopeTokenRefresher,
  signScopeToken,
  TOKEN_TTL_SECONDS,
  verifyScopeToken,
} from "./scope_token.ts";
import { SignJWT } from "jose";

Deno.test("scope tokens", async (t) => {
  await t.step("sign and verify round-trip", async () => {
    const key = await importScopeKey("test-secret");
    const scope = { accountId: "owner123", slug: "my-agent" };
    const token = await signScopeToken(key, scope);
    expect(await verifyScopeToken(key, token)).toEqual(scope);
  });

  await t.step("verify returns null for tampered token", async () => {
    const key = await importScopeKey("test-secret");
    const scope = { accountId: "owner123", slug: "my-agent" };
    const token = await signScopeToken(key, scope);
    const tampered = token.slice(0, -2) + "XX";
    expect(await verifyScopeToken(key, tampered)).toBeNull();
  });

  await t.step("verify returns null for garbage input", async () => {
    const key = await importScopeKey("test-secret");
    expect(await verifyScopeToken(key, "not-base64!!!")).toBeNull();
  });

  await t.step("verify returns null for empty string", async () => {
    const key = await importScopeKey("test-secret");
    expect(await verifyScopeToken(key, "")).toBeNull();
  });

  await t.step("different secrets produce different tokens", async () => {
    const key1 = await importScopeKey("secret-a");
    const key2 = await importScopeKey("secret-b");
    const scope = { accountId: "owner", slug: "agent" };
    expect(await signScopeToken(key1, scope)).not.toBe(
      await signScopeToken(key2, scope),
    );
  });

  await t.step("token from different secret fails verification", async () => {
    const key1 = await importScopeKey("secret-a");
    const key2 = await importScopeKey("secret-b");
    const token = await signScopeToken(key1, { accountId: "o", slug: "s" });
    expect(await verifyScopeToken(key2, token)).toBeNull();
  });

  await t.step("token includes exp claim", async () => {
    const key = await importScopeKey("test-secret");
    const token = await signScopeToken(key, {
      accountId: "o",
      slug: "s",
    });
    // Decode payload without verification to inspect claims
    const parts = token.split(".");
    const payload = JSON.parse(atob(parts[1]));
    expect(payload.exp).toBeDefined();
    expect(payload.iat).toBeDefined();
    expect(payload.exp - payload.iat).toBe(TOKEN_TTL_SECONDS);
  });

  await t.step("expired token is rejected", async () => {
    const key = await importScopeKey("test-secret");
    // Manually sign a token that expired 10 seconds ago
    const token = await new SignJWT({ sub: "o", scope: "s" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 120)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
      .sign(key);
    expect(await verifyScopeToken(key, token)).toBeNull();
  });
});

Deno.test("ScopeTokenRefresher", async (t) => {
  await t.step("returns a valid token", async () => {
    const key = await importScopeKey("test-secret");
    const scope = { accountId: "owner", slug: "agent" };
    const refresher = new ScopeTokenRefresher(key, scope);
    try {
      const token = await refresher.token();
      expect(token).toBeTruthy();
      expect(await verifyScopeToken(key, token)).toEqual(scope);
    } finally {
      refresher.stop();
    }
  });

  await t.step("stop cancels the timer", async () => {
    const key = await importScopeKey("test-secret");
    const refresher = new ScopeTokenRefresher(key, {
      accountId: "o",
      slug: "s",
    });
    await refresher.token();
    refresher.stop();
    // Double stop is safe
    refresher.stop();
  });
});

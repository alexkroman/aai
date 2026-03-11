/**
 * Scope tokens are HS256 JWTs encoding agent ownership.
 * Uses jose for signing and verification.
 * Tokens expire after TOKEN_TTL_SECONDS and are auto-refreshed.
 */

import { jwtVerify, SignJWT } from "jose";

export type AgentScope = {
  accountId: string;
  slug: string;
};

/** Opaque key type for scope token operations. */
export type ScopeKey = Uint8Array;

/** Token lifetime in seconds. */
export const TOKEN_TTL_SECONDS = 60;

const enc = new TextEncoder();

export async function importScopeKey(secret: string): Promise<ScopeKey> {
  const ikm = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: enc.encode("aai-scope-token"),
      info: enc.encode("scope-signing"),
    },
    ikm,
    256,
  );
  return new Uint8Array(bits);
}

export async function signScopeToken(
  key: ScopeKey,
  scope: AgentScope,
): Promise<string> {
  return await new SignJWT({ sub: scope.accountId, scope: scope.slug })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(key);
}

export async function verifyScopeToken(
  key: ScopeKey,
  token: string,
): Promise<AgentScope | null> {
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
    });
    const sub = payload.sub;
    const scope = payload.scope;
    if (
      typeof sub !== "string" || typeof scope !== "string" || !sub || !scope
    ) {
      return null;
    }
    return { accountId: sub, slug: scope };
  } catch {
    return null;
  }
}

/**
 * A self-refreshing scope token that re-signs before expiry.
 * Call .token to get the current valid token.
 * Call .stop() to cancel the refresh timer.
 */
export class ScopeTokenRefresher {
  #key: ScopeKey;
  #scope: AgentScope;
  #current: string = "";
  #timer: ReturnType<typeof setInterval> | undefined;
  #ready: Promise<void>;

  constructor(key: ScopeKey, scope: AgentScope) {
    this.#key = key;
    this.#scope = scope;
    this.#ready = this.#refresh();
    // Refresh 10 seconds before expiry
    const intervalMs = (TOKEN_TTL_SECONDS - 10) * 1000;
    this.#timer = setInterval(() => {
      this.#refresh();
    }, intervalMs);
    Deno.unrefTimer(this.#timer);
  }

  async #refresh(): Promise<void> {
    this.#current = await signScopeToken(this.#key, this.#scope);
  }

  /** Get the current valid token. Waits for initial sign on first call. */
  async token(): Promise<string> {
    await this.#ready;
    return this.#current;
  }

  stop(): void {
    if (this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  }
}

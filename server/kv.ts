import { Redis } from "@upstash/redis";
import { decodeBase64, encodeBase64 } from "@std/encoding/base64";

const MAX_VALUE_SIZE = 65_536;

export type KvScope = {
  ownerHash: string;
  slug: string;
};

export type KvStore = {
  get(scope: KvScope, key: string): Promise<string | null>;
  set(
    scope: KvScope,
    key: string,
    value: string,
    ttl?: number,
  ): Promise<void>;
  del(scope: KvScope, key: string): Promise<void>;
  keys(scope: KvScope, pattern?: string): Promise<string[]>;
};

function scopedKey(scope: KvScope, key: string): string {
  return `kv:${scope.ownerHash}:${scope.slug}:${key}`;
}

function scopePrefix(scope: KvScope): string {
  return `kv:${scope.ownerHash}:${scope.slug}:`;
}

let _signingKey: CryptoKey | null = null;

async function getSigningKey(): Promise<CryptoKey> {
  if (_signingKey) return _signingKey;

  const secret = Deno.env.get("UPSTASH_REDIS_REST_TOKEN") ??
    "dev-kv-signing-key";

  _signingKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return _signingKey;
}

export async function createScopeToken(scope: KvScope): Promise<string> {
  const payload = JSON.stringify({
    o: scope.ownerHash,
    s: scope.slug,
  });
  const key = await getSigningKey();
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  const sigB64 = encodeBase64(new Uint8Array(sig));
  return encodeBase64(new TextEncoder().encode(`${payload}.${sigB64}`));
}

export async function verifyScopeToken(
  token: string,
): Promise<KvScope | null> {
  let raw: string;
  try {
    raw = new TextDecoder().decode(decodeBase64(token));
  } catch {
    return null;
  }

  const dotIdx = raw.lastIndexOf(".");
  if (dotIdx === -1) return null;

  const payload = raw.slice(0, dotIdx);
  const sigB64 = raw.slice(dotIdx + 1);

  let sig: Uint8Array;
  try {
    sig = decodeBase64(sigB64);
  } catch {
    return null;
  }

  const key = await getSigningKey();
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    sig.buffer as ArrayBuffer,
    new TextEncoder().encode(payload),
  );
  if (!valid) return null;

  try {
    const parsed = JSON.parse(payload);
    if (
      typeof parsed.o !== "string" || typeof parsed.s !== "string" ||
      !parsed.o || !parsed.s
    ) {
      return null;
    }
    return { ownerHash: parsed.o, slug: parsed.s };
  } catch {
    return null;
  }
}

export function createKvStore(url: string, token: string): KvStore {
  const redis = new Redis({ url, token });

  return {
    async get(scope, key) {
      const result = await redis.get<string>(scopedKey(scope, key));
      return result ?? null;
    },

    async set(scope, key, value, ttl) {
      if (value.length > MAX_VALUE_SIZE) {
        throw new Error(`Value exceeds max size of ${MAX_VALUE_SIZE} bytes`);
      }
      if (ttl && ttl > 0) {
        await redis.set(scopedKey(scope, key), value, { ex: ttl });
      } else {
        await redis.set(scopedKey(scope, key), value);
      }
    },

    async del(scope, key) {
      await redis.del(scopedKey(scope, key));
    },

    async keys(scope, pattern) {
      const prefix = scopePrefix(scope);
      const searchPattern = pattern ? `${prefix}${pattern}` : `${prefix}*`;
      const rawKeys = await redis.keys(searchPattern);
      return rawKeys.map((k) => k.slice(prefix.length));
    },
  };
}

export function createMemoryKvStore(): KvStore {
  const store = new Map<string, { value: string; expiresAt?: number }>();

  function cleanup() {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.expiresAt && entry.expiresAt <= now) {
        store.delete(key);
      }
    }
  }

  return {
    get(scope, key) {
      cleanup();
      const entry = store.get(scopedKey(scope, key));
      return Promise.resolve(entry?.value ?? null);
    },

    set(scope, key, value, ttl) {
      if (value.length > MAX_VALUE_SIZE) {
        throw new Error(`Value exceeds max size of ${MAX_VALUE_SIZE} bytes`);
      }
      store.set(scopedKey(scope, key), {
        value,
        expiresAt: ttl && ttl > 0 ? Date.now() + ttl * 1000 : undefined,
      });
      return Promise.resolve();
    },

    del(scope, key) {
      store.delete(scopedKey(scope, key));
      return Promise.resolve();
    },

    keys(scope, pattern) {
      cleanup();
      const prefix = scopePrefix(scope);
      const results: string[] = [];
      for (const key of store.keys()) {
        if (key.startsWith(prefix)) {
          results.push(key.slice(prefix.length));
        }
      }
      if (pattern) {
        const regex = new RegExp(
          "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
        );
        return Promise.resolve(results.filter((k) => regex.test(k)));
      }
      return Promise.resolve(results);
    },
  };
}

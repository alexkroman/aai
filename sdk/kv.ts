export type KvEntry<T = unknown> = { key: string; value: T };

export type KvListOptions = {
  limit?: number;
  reverse?: boolean;
};

export type Kv = {
  get<T = unknown>(key: string): Promise<T | null>;
  set(
    key: string,
    value: unknown,
    options?: { expireIn?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
  list<T = unknown>(
    prefix: string,
    options?: KvListOptions,
  ): Promise<KvEntry<T>[]>;
};

const MAX_VALUE_SIZE = 65_536;

export function createMemoryKv(): Kv {
  const store = new Map<string, { raw: string; expiresAt?: number }>();

  function isExpired(entry: { expiresAt?: number }): boolean {
    return entry.expiresAt !== undefined && entry.expiresAt <= Date.now();
  }

  return {
    get<T = unknown>(key: string): Promise<T | null> {
      const entry = store.get(key);
      if (!entry || isExpired(entry)) {
        if (entry) store.delete(key);
        return Promise.resolve(null);
      }
      return Promise.resolve(JSON.parse(entry.raw) as T);
    },

    set(
      key: string,
      value: unknown,
      options?: { expireIn?: number },
    ): Promise<void> {
      const raw = JSON.stringify(value);
      if (raw.length > MAX_VALUE_SIZE) {
        throw new Error(`Value exceeds max size of ${MAX_VALUE_SIZE} bytes`);
      }
      const expireIn = options?.expireIn;
      store.set(key, {
        raw,
        expiresAt: expireIn && expireIn > 0 ? Date.now() + expireIn : undefined,
      });
      return Promise.resolve();
    },

    delete(key: string): Promise<void> {
      store.delete(key);
      return Promise.resolve();
    },

    list<T = unknown>(
      prefix: string,
      options?: KvListOptions,
    ): Promise<KvEntry<T>[]> {
      const now = Date.now();
      const entries: KvEntry<T>[] = [];
      for (const [key, entry] of store) {
        if (entry.expiresAt && entry.expiresAt <= now) {
          store.delete(key);
          continue;
        }
        if (key.startsWith(prefix)) {
          entries.push({ key, value: JSON.parse(entry.raw) as T });
        }
      }
      entries.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
      if (options?.reverse) entries.reverse();
      if (options?.limit && options.limit > 0) {
        entries.length = Math.min(entries.length, options.limit);
      }
      return Promise.resolve(entries);
    },
  };
}

export function createKv(
  ctx: { env: Record<string, string> },
): Kv {
  const kvUrl = ctx.env.AAI_KV_URL;
  const kvToken = ctx.env.AAI_SCOPE_TOKEN;

  if (!kvUrl || !kvToken) {
    throw new Error(
      "KV not configured: AAI_KV_URL and AAI_SCOPE_TOKEN must be set in env",
    );
  }

  async function kvFetch(body: Record<string, unknown>): Promise<unknown> {
    const resp = await fetch(kvUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${kvToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`KV error ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    if (data.error) {
      throw new Error(`KV error: ${data.error}`);
    }
    return data.result;
  }

  return {
    async get<T = unknown>(key: string): Promise<T | null> {
      const result = await kvFetch({ op: "get", key });
      if (result === null || result === undefined) return null;
      return (typeof result === "string" ? JSON.parse(result) : result) as T;
    },

    async set(
      key: string,
      value: unknown,
      options?: { expireIn?: number },
    ): Promise<void> {
      const raw = JSON.stringify(value);
      await kvFetch({
        op: "set",
        key,
        value: raw,
        ...(options?.expireIn
          ? { ttl: Math.ceil(options.expireIn / 1000) }
          : {}),
      });
    },

    async delete(key: string): Promise<void> {
      await kvFetch({ op: "del", key });
    },

    async list<T = unknown>(
      prefix: string,
      options?: KvListOptions,
    ): Promise<KvEntry<T>[]> {
      const result = await kvFetch({
        op: "list",
        prefix,
        limit: options?.limit,
        reverse: options?.reverse,
      });
      return result as KvEntry<T>[];
    },
  };
}

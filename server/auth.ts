// Copyright 2025 the AAI authors. MIT license.
import { encodeHex } from "@std/encoding/hex";
import type { BundleStore } from "./bundle_store_tigris.ts";

export async function hashApiKey(apiKey: string): Promise<string> {
  const data = new TextEncoder().encode(apiKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return encodeHex(new Uint8Array(hashBuffer));
}

/** Generate a stable account ID (UUID v4). */
export function generateAccountId(): string {
  return crypto.randomUUID();
}

export type OwnerResult =
  | { status: "unclaimed"; keyHash: string }
  | { status: "owned"; accountId: string; keyHash: string }
  | { status: "forbidden" };

/**
 * Verify API key ownership of a slug via its manifest.
 *
 * - If no manifest exists (unclaimed slug), returns `{ status: "unclaimed", keyHash }`.
 * - If the manifest has credential_hashes and the key matches, returns `{ status: "owned", accountId, keyHash }`.
 * - If the key doesn't match, returns `{ status: "forbidden" }`.
 */
export async function verifySlugOwner(
  apiKey: string,
  opts: { slug: string; store: BundleStore },
): Promise<OwnerResult> {
  const { slug, store } = opts;
  const keyHash = await hashApiKey(apiKey);
  const manifest = await store.getManifest(slug);

  if (!manifest) {
    return { status: "unclaimed", keyHash };
  }

  // If manifest has credential_hashes, check them
  if (manifest.credential_hashes?.includes(keyHash)) {
    return {
      status: "owned",
      accountId: manifest.account_id ?? keyHash,
      keyHash,
    };
  }

  // Legacy manifests without credential_hashes: allow deploy (will add hashes)
  if (!manifest.credential_hashes) {
    return {
      status: "owned",
      accountId: manifest.account_id ?? keyHash,
      keyHash,
    };
  }

  return { status: "forbidden" };
}

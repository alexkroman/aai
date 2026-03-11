import { encodeHex } from "@std/encoding/hex";
import type { BundleStore, NamespaceOwner } from "./bundle_store_tigris.ts";

export async function hashApiKey(apiKey: string): Promise<string> {
  const data = new TextEncoder().encode(apiKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return encodeHex(new Uint8Array(hashBuffer));
}

/** Generate a stable account ID (UUID v4). */
export function generateAccountId(): string {
  return crypto.randomUUID();
}

/** Verify an API key against namespace ownership. Does not claim. */
export async function verifyOwner(
  apiKey: string,
  namespace: string,
  store: BundleStore,
): Promise<string | null> {
  const keyHash = await hashApiKey(apiKey);
  const existing = await store.getNamespaceOwner(namespace);
  if (!existing) return keyHash; // unclaimed — caller decides whether to claim
  return existing.credential_hashes.includes(keyHash)
    ? existing.account_id
    : null;
}

/** Claim a namespace for an owner hash. */
export async function claimNamespace(
  namespace: string,
  owner: NamespaceOwner,
  store: BundleStore,
): Promise<void> {
  await store.putNamespaceOwner(namespace, owner);
}

/**
 * Atomically verify and claim a namespace.
 * Returns the accountId if the caller owns (or just claimed) the namespace, null otherwise.
 */
export async function verifyOrClaimNamespace(
  apiKey: string,
  namespace: string,
  store: BundleStore,
): Promise<string | null> {
  const keyHash = await hashApiKey(apiKey);
  const existing = await store.getNamespaceOwner(namespace);

  if (existing) {
    return existing.credential_hashes.includes(keyHash)
      ? existing.account_id
      : null;
  }

  // Unclaimed — attempt atomic claim with new account ID
  const accountId = generateAccountId();
  const owner: NamespaceOwner = {
    account_id: accountId,
    credential_hashes: [keyHash],
  };
  const claimed = await store.claimIfUnclaimed(namespace, owner);
  if (claimed) return accountId;

  // Someone else claimed between our check and our write — re-verify
  const nowOwner = await store.getNamespaceOwner(namespace);
  return nowOwner?.credential_hashes.includes(keyHash)
    ? nowOwner.account_id
    : null;
}

/** Add a new credential hash to an existing namespace (for key rotation). */
export async function addCredential(
  apiKey: string,
  newKeyHash: string,
  namespace: string,
  store: BundleStore,
): Promise<boolean> {
  const callerHash = await hashApiKey(apiKey);
  const existing = await store.getNamespaceOwner(namespace);
  if (!existing || !existing.credential_hashes.includes(callerHash)) {
    return false;
  }
  if (existing.credential_hashes.includes(newKeyHash)) return true;
  existing.credential_hashes.push(newKeyHash);
  await store.putNamespaceOwner(namespace, existing);
  return true;
}

/** Remove a credential hash from a namespace (for key rotation). */
export async function removeCredential(
  apiKey: string,
  oldKeyHash: string,
  namespace: string,
  store: BundleStore,
): Promise<boolean> {
  const callerHash = await hashApiKey(apiKey);
  const existing = await store.getNamespaceOwner(namespace);
  if (!existing || !existing.credential_hashes.includes(callerHash)) {
    return false;
  }
  existing.credential_hashes = existing.credential_hashes.filter(
    (h) => h !== oldKeyHash,
  );
  if (existing.credential_hashes.length === 0) return false; // can't remove last
  await store.putNamespaceOwner(namespace, existing);
  return true;
}

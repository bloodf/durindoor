import { createHash } from "node:crypto";
import { isString } from "./typeChecks.js";

/** Identify dispatched credential material without persisting the secret. */
export function credentialFingerprint(secret) {
  return isString(secret) && secret.length > 0 ?
    createHash("sha256").update(secret).digest("hex") : null;
}

function storedCredentials(connection) {
  const extras = connection?.providerSpecificData?.extraApiKeys;
  return [connection?.accessToken, connection?.apiKey, ...(Array.isArray(extras) ? extras : [])]
    .filter((secret) => isString(secret) && secret.length > 0);
}

/** Check a snapshot against the current primary and extra credentials. */
export function connectionHasCredential(connection, fingerprint) {
  if (!fingerprint) return true;
  return storedCredentials(connection).some((secret) => credentialFingerprint(secret) === fingerprint);
}

/** Short, non-reversible per-key id used as the key-health map key. */
export function credentialKeyId(fingerprint) {
  return isString(fingerprint) && fingerprint.length >= 16 ? fingerprint.slice(0, 16) : null;
}

/** Key ids of every credential the connection currently stores. */
export function connectionCredentialKeyIds(connection) {
  return new Set(storedCredentials(connection).map((secret) => credentialKeyId(credentialFingerprint(secret))));
}

export function connectionHasMultipleCredentials(connection) {
  const extras = connection?.providerSpecificData?.extraApiKeys;
  return Array.isArray(extras) && extras.some((secret) => isString(secret) && secret.length > 0);
}

/**
 * Snapshot taken when a request is dispatched. The fingerprint binds a later
 * outcome write to the stored credential that was actually sent; a derived or
 * exchanged token that is not stored on the row yields no fingerprint, so the
 * write stays fail-open instead of being dropped.
 */
export function credentialDispatchSnapshot(credentials, dispatchedAt = Date.now()) {
  const fingerprint = credentialFingerprint(credentials?.accessToken || credentials?.apiKey);
  const stored = credentials?._connection;
  return {
    credentialFingerprint: fingerprint && stored && connectionHasCredential(stored, fingerprint) ? fingerprint : null,
    dispatchedAt
  };
}

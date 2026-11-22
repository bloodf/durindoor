import { createHash } from "node:crypto";

/** Identify dispatched credential material without persisting the secret. */
export function credentialFingerprint(secret) {
  return typeof secret === "string" && secret.length > 0 ?
    createHash("sha256").update(secret).digest("hex") : null;
}

/** Check a snapshot against the current primary and extra credentials. */
export function connectionHasCredential(connection, fingerprint) {
  if (!fingerprint) return true;
  const extras = connection?.providerSpecificData?.extraApiKeys;
  return [connection?.accessToken, connection?.apiKey, ...(Array.isArray(extras) ? extras : [])]
    .some((secret) => credentialFingerprint(secret) === fingerprint);
}

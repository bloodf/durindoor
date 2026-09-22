// Request shape for saving a pasted OrcaRouter API key from the connect modal.

/**
 * The saved API-key row to replace, if there is one. Only `apikey` rows are
 * replaced in place; an OAuth row keeps its own key and is renewed by signing
 * in again, so the modal never shows an OAuth key as the one a paste replaces.
 * @param {Array<object>|null} connections - `GET /api/providers` connections
 * @returns {object|null}
 */
export function orcaApiKeyTarget(connections) {
  return (Array.isArray(connections) ? connections : []).
  find((c) => c?.provider === "orcarouter" && c.authType === "apikey") || null;
}

/**
 * @param {Array<object>|null} connections - `GET /api/providers` connections
 * @returns {string|null}
 */
export function orcaApiKeyTargetId(connections) {
  return orcaApiKeyTarget(connections)?.id || null;
}

/**
 * `POST /api/providers` is create-only, so saving a second key under the same
 * name would 409 and leave the old key in place. With an existing API-key row
 * the new key goes to that row instead, reactivated so a key that was
 * quarantined as rejected returns to rotation.
 * @param {string|null} targetId - From `orcaApiKeyTargetId`
 * @param {string} apiKey - The pasted key, already trimmed
 * @returns {{ url: string, method: string, body: object }}
 */
export function orcaApiKeySaveRequest(targetId, apiKey) {
  if (targetId) {
    return {
      url: `/api/providers/${encodeURIComponent(targetId)}`,
      method: "PUT",
      body: { apiKey, isActive: true, testStatus: "active" }
    };
  }
  return {
    url: "/api/providers",
    method: "POST",
    body: { provider: "orcarouter", apiKey, name: "OrcaRouter API Key" }
  };
}

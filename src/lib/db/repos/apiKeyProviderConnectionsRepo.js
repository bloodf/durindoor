// API-key-to-provider-account relation repository. Persists the opt-in
// restriction model ported from decolua/9router#3661 — an API key with no
// relation rows stays unrestricted; rows enumerate the provider connections
// that key may route through.
//
// Backward-compatibility invariant: zero relation rows for a key means
// unrestricted (legacy sk-<8 hex> keys and any key the operator has not yet
// scoped must keep working exactly as before). Enforcement lives in the
// shared selector seam; this file only owns the join-table CRUD.
import { getAdapter } from "../driver.js";
import { isString } from "../../../shared/utils/typeChecks.js";

/**
 * Return the provider-connection ids the given API key is currently scoped to.
 * Empty array means the key is unrestricted. Unknown key ids return [] — the
 * caller should validate the key with the apiKeys repo before treating the
 * result as policy.
 */
export async function getApiKeyProviderConnectionIds(apiKeyId) {
  if (!isString(apiKeyId) || !apiKeyId.trim()) return [];
  const db = await getAdapter();
  const rows = db.all(
    `SELECT connectionId FROM apiKeyProviderConnections WHERE apiKeyId = ? ORDER BY connectionId ASC`,
    [apiKeyId]
  );
  return rows.map((r) => r.connectionId);
}

/**
 * Atomically replace the provider-connection ids scoped to an API key. Pass
 * [] to revoke every relation, leaving the key unrestricted under the
 * zero-rows invariant. Duplicate or missing API-key/provider-connection ids
 * reject. Returns canonical persisted connection ids; transaction rollback
 * prevents a partial replace.
 */
export async function setApiKeyProviderConnectionIds(apiKeyId, connectionIds) {
  const normalizedApiKeyId = isString(apiKeyId) ? apiKeyId.trim() : "";
  if (!normalizedApiKeyId) {
    throw new Error("apiKeyId must be a non-empty string");
  }
  if (!Array.isArray(connectionIds)) {
    throw new Error("connectionIds must be an array of provider connection id strings");
  }

  const cleaned = [];
  const seen = new Set();
  for (const raw of connectionIds) {
    if (!isString(raw) || !raw.trim()) {
      throw new Error("connectionIds entries must be non-empty strings");
    }
    const id = raw.trim();
    if (seen.has(id)) {
      throw new Error(`Duplicate provider connection id: ${id}`);
    }
    seen.add(id);
    cleaned.push(id);
  }

  const db = await getAdapter();
  db.transaction(() => {
    const keyRow = db.get(`SELECT id FROM apiKeys WHERE id = ?`, [normalizedApiKeyId]);
    if (!keyRow) throw new Error(`API key not found: ${apiKeyId}`);

    const providerConnectionIds = new Set(
      db.all(`SELECT id FROM providerConnections`).map((row) => row.id)
    );
    const missing = cleaned.find((id) => !providerConnectionIds.has(id));
    if (missing) {
      throw new Error(`Provider connection not found: ${missing}`);
    }

    db.run(`DELETE FROM apiKeyProviderConnections WHERE apiKeyId = ?`, [normalizedApiKeyId]);
    for (const connectionId of cleaned) {
      db.run(
        `INSERT OR IGNORE INTO apiKeyProviderConnections(apiKeyId, connectionId) VALUES(?, ?)`,
        [normalizedApiKeyId, connectionId]
      );
    }
  });
  return cleaned;
}

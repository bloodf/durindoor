import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { isString } from "../../../shared/utils/typeChecks.js";

/**
 * API key group repository.
 *
 * Groups are organizational labels for the API Keys page and carry NO
 * authority: what a key may do stays governed by its own `policy`,
 * `allowedCombos`, and `apiKeyProviderConnections` rows. Nothing here is
 * consulted on the request path.
 *
 * Membership is many-to-many (`apiKeyGroupMembers`) so one key can belong to
 * several groups. Deleting a group cascades to its membership rows only — the
 * keys themselves survive, because losing a credential along with its label
 * would be an unacceptable failure mode.
 */

function rowToGroup(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Reject blank names so a group cannot be created without a usable label. */
function normalizeName(value) {
  const name = isString(value) ? value.trim() : "";
  if (!name) throw new TypeError("Group name is required");
  if (name.length > 100) throw new TypeError("Group name must be 100 characters or fewer");
  return name;
}

function normalizeDescription(value) {
  if (value === undefined || value === null) return null;
  const description = isString(value) ? value.trim() : "";
  return description || null;
}

export async function getApiKeyGroups() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM apiKeyGroups ORDER BY name COLLATE NOCASE ASC`);
  return (rows || []).map(rowToGroup);
}

export async function getApiKeyGroupById(id) {
  const db = await getAdapter();
  return rowToGroup(db.get(`SELECT * FROM apiKeyGroups WHERE id = ?`, [id]));
}

export async function createApiKeyGroup({ name, description } = {}) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const group = {
    id: uuidv4(),
    name: normalizeName(name),
    description: normalizeDescription(description),
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO apiKeyGroups (id, name, description, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`,
    [group.id, group.name, group.description, group.createdAt, group.updatedAt],
  );
  return group;
}

export async function updateApiKeyGroup(id, { name, description } = {}) {
  const db = await getAdapter();
  const existing = db.get(`SELECT * FROM apiKeyGroups WHERE id = ?`, [id]);
  if (!existing) return null;

  const nextName = name === undefined ? existing.name : normalizeName(name);
  const nextDescription =
    description === undefined ? existing.description ?? null : normalizeDescription(description);
  const updatedAt = new Date().toISOString();

  db.run(`UPDATE apiKeyGroups SET name = ?, description = ?, updatedAt = ? WHERE id = ?`, [
    nextName,
    nextDescription,
    updatedAt,
    id,
  ]);
  return rowToGroup({ ...existing, name: nextName, description: nextDescription, updatedAt });
}

/**
 * Delete a group. Membership rows cascade; the keys themselves are untouched.
 * @returns {Promise<boolean>} whether a group was removed
 */
export async function deleteApiKeyGroup(id) {
  const db = await getAdapter();
  const existing = db.get(`SELECT id FROM apiKeyGroups WHERE id = ?`, [id]);
  if (!existing) return false;
  db.run(`DELETE FROM apiKeyGroups WHERE id = ?`, [id]);
  return true;
}

/** Group ids for one key, sorted by group name. */
export async function getGroupIdsForApiKey(apiKeyId) {
  const db = await getAdapter();
  const rows = db.all(
    `SELECT m.groupId AS groupId FROM apiKeyGroupMembers m
       JOIN apiKeyGroups g ON g.id = m.groupId
      WHERE m.apiKeyId = ?
      ORDER BY g.name COLLATE NOCASE ASC`,
    [apiKeyId],
  );
  return (rows || []).map((row) => row.groupId);
}

/** Group ids keyed by API-key id, so a list view needs one query, not N. */
export async function getGroupIdsByApiKey() {
  const db = await getAdapter();
  const rows = db.all(
    `SELECT m.apiKeyId AS apiKeyId, m.groupId AS groupId FROM apiKeyGroupMembers m
       JOIN apiKeyGroups g ON g.id = m.groupId
      ORDER BY g.name COLLATE NOCASE ASC`,
  );
  const byKey = {};
  for (const row of rows || []) {
    (byKey[row.apiKeyId] ||= []).push(row.groupId);
  }
  return byKey;
}

/**
 * Replace a key's group membership with exactly `groupIds`.
 *
 * Unknown or malformed ids are REJECTED, not skipped. This call deletes the
 * existing membership before inserting, so silently dropping a bad id would
 * turn a typo — or a stale tab whose group was deleted elsewhere — into
 * unannounced data loss: the operator asks for two groups, gets one, and sees
 * no error. Matching setApiKeyProviderConnectionIds, the caller gets a 400.
 *
 * Validation and the delete/insert pair run inside ONE transaction, so a
 * failure partway through rolls back rather than leaving the key with no
 * groups. Existence of the key is checked in that same transaction: assigning
 * groups to a key that no longer exists would otherwise silently succeed.
 *
 * @throws {TypeError} when an id is not a non-empty string or names no group
 * @throws {Error} when the API key does not exist
 */
export async function setApiKeyGroups(apiKeyId, groupIds) {
  if (groupIds !== undefined && !Array.isArray(groupIds)) {
    throw new TypeError("groupIds must be an array of group id strings");
  }
  const raw = Array.isArray(groupIds) ? groupIds : [];
  if (raw.some((id) => !isString(id) || !id.trim())) {
    throw new TypeError("groupIds must be an array of group id strings");
  }
  const requested = [...new Set(raw.map((id) => id.trim()))];

  const db = await getAdapter();
  db.transaction(() => {
    const keyRow = db.get(`SELECT id FROM apiKeys WHERE id = ?`, [apiKeyId]);
    if (!keyRow) throw new Error(`API key not found: ${apiKeyId}`);

    const known = new Set((db.all(`SELECT id FROM apiKeyGroups`) || []).map((row) => row.id));
    const unknown = requested.filter((id) => !known.has(id));
    if (unknown.length) {
      throw new TypeError(`Unknown group id(s): ${unknown.join(", ")}`);
    }

    db.run(`DELETE FROM apiKeyGroupMembers WHERE apiKeyId = ?`, [apiKeyId]);
    const now = new Date().toISOString();
    for (const groupId of requested) {
      db.run(
        `INSERT OR IGNORE INTO apiKeyGroupMembers (groupId, apiKeyId, createdAt) VALUES (?, ?, ?)`,
        [groupId, apiKeyId, now],
      );
    }
  });
  return requested;
}

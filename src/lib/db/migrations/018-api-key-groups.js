// Add API-key groups: purely organizational labels for the API Keys page.
//
// - `apiKeyGroups`: named, optionally described buckets an operator creates to
//   organize keys (e.g. "CI", "Personal", "Team"). Groups carry NO authority —
//   they never widen or narrow what a key may do. Access stays governed by the
//   key's own `policy`, `allowedCombos`, and `apiKeyProviderConnections` rows.
// - `apiKeyGroupMembers`: many-to-many membership, so a key can sit in several
//   groups (a CI key that is also a staging key) without duplicating the key.
//
// Membership is deliberately a join table rather than a `groupId` column on
// `apiKeys`: a column would cap each key at one group and would need a second
// migration the first time an operator wants overlap.
//
// Both foreign keys cascade. Deleting a group drops its membership rows and
// leaves every key intact — losing a key because its label was deleted would
// be an unacceptable failure mode for a credential.
//
// Idempotent — safe on databases that already created these via the
// declarative schema sync in schema.js TABLES (fresh installs get everything
// from there; this migration only CREATEs on upgrade paths).
const migration = {
  version: 18,
  name: "api-key-groups",
  up(db) {
    const hasTable = (name) => {
      const rows = db.all(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [name]);
      return Array.isArray(rows) && rows.length > 0;
    };

    if (!hasTable("apiKeyGroups")) {
      db.exec(`CREATE TABLE apiKeyGroups (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_akg_name ON apiKeyGroups(name COLLATE NOCASE)`);
    }

    if (!hasTable("apiKeyGroupMembers")) {
      db.exec(`CREATE TABLE apiKeyGroupMembers (
        groupId TEXT NOT NULL REFERENCES apiKeyGroups(id) ON DELETE CASCADE,
        apiKeyId TEXT NOT NULL REFERENCES apiKeys(id) ON DELETE CASCADE,
        createdAt TEXT NOT NULL,
        PRIMARY KEY (groupId, apiKeyId)
      )`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_akgm_key ON apiKeyGroupMembers(apiKeyId)`);
    }
  },
};

export default migration;

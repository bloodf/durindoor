// Add connection groups, per-combo connection allow-list, and future-only
// usage-by-combo attribution (issue #747 / port of decolua/9router #3748,
// minus the unsafe key-export unit — see issue #747 for the security block).
//
// - `combos.allowedConnectionIds`: optional JSON array of provider-connection
//   ids. Empty/unset (NULL or "[]") means unrestricted — current behavior.
//   A populated array restricts dispatch to exactly those connections,
//   enforced at the shared selection seam (getProviderCredentials).
// - `connectionGroups` / `connectionGroupMembers`: purely organizational
//   grouping of provider connections. Groups do not themselves gate dispatch;
//   the dashboard expands a group's membership into `allowedConnectionIds`
//   when an operator assigns a group to a combo.
// - `usageHistory.comboId` / `.comboName`: persisted at write time for
//   requests dispatched through a combo, starting from this migration only.
//   Historic rows (and `usageDaily` aggregates, which have no combo column)
//   are intentionally left unattributed and MUST NOT be backfilled — the
//   database never recorded which combo (if any) selected those requests.
//
// Idempotent — safe on databases that already created these via the
// declarative schema sync (fresh installs get everything from schema.js
// TABLES; this migration only ALTERs/CREATEs on upgrade paths).
const migration = {
  version: 17,
  name: "connection-groups",
  up(db) {
    const hasTable = (name) => {
      const rows = db.all(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [name]);
      return Array.isArray(rows) && rows.length > 0;
    };
    const hasColumn = (table, column) => {
      const cols = db.all(`PRAGMA table_info(${table})`);
      return Array.isArray(cols) && cols.some((c) => c.name === column);
    };

    if (hasTable("combos") && !hasColumn("combos", "allowedConnectionIds")) {
      db.exec(`ALTER TABLE combos ADD COLUMN allowedConnectionIds TEXT`);
    }

    if (hasTable("usageHistory")) {
      if (!hasColumn("usageHistory", "comboId")) {
        db.exec(`ALTER TABLE usageHistory ADD COLUMN comboId TEXT`);
      }
      if (!hasColumn("usageHistory", "comboName")) {
        db.exec(`ALTER TABLE usageHistory ADD COLUMN comboName TEXT`);
      }
    }

    if (!hasTable("connectionGroups")) {
      db.exec(`CREATE TABLE connectionGroups (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_cg_name ON connectionGroups(name COLLATE NOCASE)`);
    }

    if (!hasTable("connectionGroupMembers")) {
      db.exec(`CREATE TABLE connectionGroupMembers (
        groupId TEXT NOT NULL REFERENCES connectionGroups(id) ON DELETE CASCADE,
        connectionId TEXT NOT NULL REFERENCES providerConnections(id) ON DELETE CASCADE,
        createdAt TEXT NOT NULL,
        PRIMARY KEY (groupId, connectionId)
      )`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_cgm_connection ON connectionGroupMembers(connectionId)`);
    }
  },
};

export default migration;

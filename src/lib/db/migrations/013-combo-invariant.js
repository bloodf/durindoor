// Add the combos.invariant column: optional declarative allowed-providers /
// allowed-model-families constraint validated on combo create/update
// (port of OmniRoute #8304). Idempotent — safe on databases that already
// created the column via the declarative schema sync.
const migration = {
  version: 13,
  name: "combo-invariant",
  up(db) {
    // The combos table may not exist yet on some upgrade paths — the declarative
    // schema sync creates it (already carrying the `invariant` column) after the
    // versioned runner runs. Only ALTER an existing table that lacks the column.
    const tables = db.all(`SELECT name FROM sqlite_master WHERE type='table' AND name='combos'`);
    if (!Array.isArray(tables) || tables.length === 0) return;
    const cols = db.all(`PRAGMA table_info(combos)`);
    const hasInvariant = Array.isArray(cols) && cols.some((c) => c.name === "invariant");
    if (!hasInvariant) {
      db.exec(`ALTER TABLE combos ADD COLUMN invariant TEXT`);
    }
  },
};

export default migration;

// Add the combos.invariant column: optional declarative allowed-providers /
// allowed-model-families constraint validated on combo create/update
// (port of OmniRoute #8304). Idempotent — safe on databases that already
// created the column via the declarative schema sync.
const migration = {
  version: 13,
  name: "combo-invariant",
  up(db) {
    const cols = db.all(`PRAGMA table_info(combos)`);
    const hasInvariant = Array.isArray(cols) && cols.some((c) => c.name === "invariant");
    if (!hasInvariant) {
      db.exec(`ALTER TABLE combos ADD COLUMN invariant TEXT`);
    }
  },
};

export default migration;

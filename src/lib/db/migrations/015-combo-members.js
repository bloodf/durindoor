// Add persisted weighted combo members. Legacy string `models` rows remain valid.
const migration = {
  version: 15,
  name: "combo-members",
  up(db) {
    const tables = db.all(`SELECT name FROM sqlite_master WHERE type='table' AND name='combos'`);
    if (!Array.isArray(tables) || tables.length === 0) return;
    const cols = db.all(`PRAGMA table_info(combos)`);
    if (!cols.some((column) => column.name === "members")) {
      db.exec(`ALTER TABLE combos ADD COLUMN members TEXT`);
    }
  },
};

export default migration;

// Persist optional operator capability ceilings for combos.
const migration = {
  version: 16,
  name: "combo-capabilities",
  up(db) {
    const tables = db.all(`SELECT name FROM sqlite_master WHERE type='table' AND name='combos'`);
    if (!Array.isArray(tables) || tables.length === 0) return;
    const columns = db.all(`PRAGMA table_info(combos)`);
    if (!columns.some((column) => column.name === "capabilities")) {
      db.exec(`ALTER TABLE combos ADD COLUMN capabilities TEXT`);
    }
  },
};

export default migration;

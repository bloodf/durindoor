// Schema version 4 shipped with the daily token limit. Keep this migration at
// v4 permanently so databases created by earlier nightly builds are not
// reinterpreted as having a different column.
export default {
  version: 4,
  name: "add-daily-token-limit-to-api-keys",
  up(db) {
    try {
      db.exec("ALTER TABLE apiKeys ADD COLUMN dailyLimitTokens INTEGER");
    } catch (err) {
      if (!/duplicate column|already exists|column.*exists/i.test(String(err))) {
        throw err;
      }
    }
  },
};

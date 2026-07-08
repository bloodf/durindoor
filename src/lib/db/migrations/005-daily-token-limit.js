export default {
  version: 5,
  name: "add daily token limit to apiKeys",
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

// Preserve the historical daily-limit migration after API-key expiry claimed
// version 4. Existing databases may already have the column, so the operation
// remains additive and idempotent.
export default {
  version: 5,
  name: "add daily token limit to apiKeys",
  up(db) {
    try {
      db.exec("ALTER TABLE apiKeys ADD COLUMN dailyLimitTokens INTEGER");
    } catch (error) {
      if (!/duplicate column|already exists|column.*exists/i.test(String(error))) {
        throw error;
      }
    }
  },
};

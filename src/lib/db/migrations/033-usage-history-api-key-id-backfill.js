import { backfillUsageHistoryApiKeyIds } from "./030-usage-history-api-key-id.js";

export default {
  version: 33,
  name: "usage-history-api-key-id-backfill",
  up(db) {
    backfillUsageHistoryApiKeyIds(db);
  },
};

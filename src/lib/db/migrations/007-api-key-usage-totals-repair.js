import { ensureAndBackfillApiKeyUsageTotals } from "./apiKeyUsageTotalsBackfill.js";

/**
 * Repair databases already stamped at schema version 6. Rewriting migration 6
 * would not run for them, so this forward migration reconciles totals once and
 * remains safe if its body is invoked repeatedly.
 */
export default {
  version: 7,
  name: "api-key-usage-totals-repair",
  up(db) {
    ensureAndBackfillApiKeyUsageTotals(db);
  },
};

// Manual model capability overrides per provider/model target. The UI stores targets
// in the same provider/model shape used by combos, so provider-specific model caps do
// not leak across providers that expose the same model id.
const migration = {
  version: 11,
  name: "model-capability-overrides",
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS modelCapabilityOverrides (
      provider TEXT NOT NULL,
      modelId TEXT NOT NULL,
      overrideKey TEXT NOT NULL,
      overrideValue TEXT NOT NULL,
      refreshedAt TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (provider, modelId, overrideKey)
    ) WITHOUT ROWID`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_model_capability_overrides_key
      ON modelCapabilityOverrides (overrideKey)`);
  },
};

export default migration;

import { QUOTA_V7_TABLES } from "./migrations/quota-v7-schema.js";
import { QUOTA_V8_TABLES } from "./migrations/quota-v8-schema.js";
import { TOKEN_SAVER_DAILY_TABLES } from "./migrations/token-saver-daily-schema.js";

// Latest schema version — bumped when a migration is added in ./migrations/
// 19 is intentionally skipped: it is reserved for the PostgreSQL-only
// `pg-cutover-log` migration, and check-postgres-migrations.mjs requires a
// shared version to carry the same name in both migration sets.
export const SCHEMA_VERSION = 24;

export const PRAGMA_SQL = `
PRAGMA busy_timeout = 5000;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 30000000;
PRAGMA cache_size = -64000;
PRAGMA foreign_keys = ON;
`;

// Declarative current schema. Used by syncSchemaFromTables() to
// auto-add missing tables/columns/indexes after versioned migrations.
// For destructive changes (drop/rename/type-change), write a migration file.
export const TABLES = {
  _meta: {
    columns: {
      key: "TEXT PRIMARY KEY",
      value: "TEXT NOT NULL",
    },
  },
  settings: {
    columns: {
      id: "INTEGER PRIMARY KEY CHECK (id = 1)",
      data: "TEXT NOT NULL",
    },
  },
  providerConnections: {
    columns: {
      id: "TEXT PRIMARY KEY",
      provider: "TEXT NOT NULL",
      authType: "TEXT NOT NULL",
      name: "TEXT",
      email: "TEXT",
      priority: "INTEGER",
      isActive: "INTEGER DEFAULT 1",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pc_provider ON providerConnections(provider)",
      "CREATE INDEX IF NOT EXISTS idx_pc_provider_active ON providerConnections(provider, isActive)",
      "CREATE INDEX IF NOT EXISTS idx_pc_priority ON providerConnections(provider, priority)",
    ],
  },
  providerQuotaSnapshots: QUOTA_V7_TABLES.providerQuotaSnapshots,
  quotaFetchStates: QUOTA_V7_TABLES.quotaFetchStates,
  quotaReservations: QUOTA_V8_TABLES.quotaReservations,
  quotaReservationItems: QUOTA_V8_TABLES.quotaReservationItems,
  providerNodes: {
    columns: {
      id: "TEXT PRIMARY KEY",
      type: "TEXT",
      name: "TEXT",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_pn_type ON providerNodes(type)"],
  },
  proxyPools: {
    columns: {
      id: "TEXT PRIMARY KEY",
      isActive: "INTEGER DEFAULT 1",
      testStatus: "TEXT",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pp_active ON proxyPools(isActive)",
      "CREATE INDEX IF NOT EXISTS idx_pp_status ON proxyPools(testStatus)",
    ],
  },
  apiKeys: {
    columns: {
      id: "TEXT PRIMARY KEY",
      key: "TEXT UNIQUE NOT NULL",
      name: "TEXT",
      machineId: "TEXT",
      isActive: "INTEGER DEFAULT 1",
      allowedCombos: "TEXT",
      dailyLimitTokens: "INTEGER",
      policy: "TEXT",
      expiresAt: "TEXT",
      createdAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_ak_key ON apiKeys(key)"],
  },
  // Opt-in API-key-to-provider-account restriction. No rows for a key means
  // unrestricted; both parent deletions cascade to preserve referential integrity.
  apiKeyProviderConnections: {
    columns: {
      apiKeyId: "TEXT NOT NULL REFERENCES apiKeys(id) ON DELETE CASCADE",
      connectionId: "TEXT NOT NULL REFERENCES providerConnections(id) ON DELETE CASCADE",
    },
    primaryKey: "PRIMARY KEY (apiKeyId, connectionId)",
  },
  // Organizational grouping for the API Keys page. Groups carry NO authority:
  // access stays governed by a key's policy, allowedCombos, and
  // apiKeyProviderConnections rows. Membership is many-to-many so one key can
  // belong to several groups, and deleting a group never deletes a key.
  apiKeyGroups: {
    columns: {
      id: "TEXT PRIMARY KEY",
      name: "TEXT UNIQUE NOT NULL",
      description: "TEXT",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_akg_name ON apiKeyGroups(name COLLATE NOCASE)"],
  },
  apiKeyGroupMembers: {
    columns: {
      groupId: "TEXT NOT NULL REFERENCES apiKeyGroups(id) ON DELETE CASCADE",
      apiKeyId: "TEXT NOT NULL REFERENCES apiKeys(id) ON DELETE CASCADE",
      createdAt: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (groupId, apiKeyId)",
    indexes: ["CREATE INDEX IF NOT EXISTS idx_akgm_key ON apiKeyGroupMembers(apiKeyId)"],
  },
  apiKeyUsageTotals: {
    columns: {
      apiKeyId: "TEXT PRIMARY KEY REFERENCES apiKeys(id) ON DELETE CASCADE",
      totalTokens: "INTEGER NOT NULL DEFAULT 0",
      totalCost: "REAL NOT NULL DEFAULT 0",
      totalRequests: "INTEGER NOT NULL DEFAULT 0",
      updatedAt: "TEXT",
    },
  },
  combos: {
    columns: {
      id: "TEXT PRIMARY KEY",
      name: "TEXT UNIQUE NOT NULL",
      kind: "TEXT",
      models: "TEXT NOT NULL",
      invariant: "TEXT",
      // Optional [{ id, weight }]. Legacy `models` strings remain routing source.
      members: "TEXT",
      capabilities: "TEXT",
      // Optional JSON array of provider-connection ids. Empty / NULL means
      // unrestricted (current behavior). When populated, dispatch at the shared
      // selection seam only ever considers those connections for this combo.
      // Set by the connection-groups / combo allow-list editor (issue #747).
      allowedConnectionIds: "TEXT",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_combo_name ON combos(name)",
      "CREATE INDEX IF NOT EXISTS idx_combo_name_nocase ON combos(name COLLATE NOCASE)",
    ],
  },
  // Connection groups: organizational bundling of provider-connections. The
  // group itself is not a dispatch unit — combos reference connection ids
  // directly via allowedConnectionIds. Groups simplify UI management: the
  // dashboard expands a group into its member ids when assigning it to a
  // combo (issue #747 / port of decolua/9router #3748).
  connectionGroups: {
    columns: {
      id: "TEXT PRIMARY KEY",
      name: "TEXT UNIQUE NOT NULL",
      description: "TEXT",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_cg_name ON connectionGroups(name COLLATE NOCASE)",
    ],
  },
  connectionGroupMembers: {
    columns: {
      groupId: "TEXT NOT NULL REFERENCES connectionGroups(id) ON DELETE CASCADE",
      connectionId: "TEXT NOT NULL REFERENCES providerConnections(id) ON DELETE CASCADE",
      createdAt: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (groupId, connectionId)",
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_cgm_connection ON connectionGroupMembers(connectionId)",
    ],
  },
  mcpInstances: {
    columns: {
      id: "TEXT PRIMARY KEY",
      slug: "TEXT UNIQUE NOT NULL",
      title: "TEXT",
      kind: "TEXT NOT NULL",
      transport: "TEXT NOT NULL",
      url: "TEXT",
      command: "TEXT",
      args: "TEXT",
      env: "TEXT",
      headers: "TEXT",
      oauth: "INTEGER DEFAULT 0",
      oauthTokens: "TEXT",
      providerConnectionId: "TEXT",
      enabled: "INTEGER DEFAULT 1",
      createdAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_mcp_inst_slug ON mcpInstances(slug)",
      "CREATE INDEX IF NOT EXISTS idx_mcp_inst_enabled ON mcpInstances(enabled)",
    ],
  },
  mcpGatewayKeys: {
    columns: {
      id: "TEXT PRIMARY KEY",
      name: "TEXT",
      key: "TEXT UNIQUE NOT NULL",
      machineId: "TEXT",
      isActive: "INTEGER DEFAULT 1",
      createdAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_mcp_gwkey ON mcpGatewayKeys(key)"],
  },
  mcpKeyGrants: {
    columns: {
      keyId: "TEXT NOT NULL",
      instanceId: "TEXT NOT NULL",
      toolAllowlist: "TEXT",
    },
    primaryKey: "PRIMARY KEY (keyId, instanceId)",
    indexes: ["CREATE INDEX IF NOT EXISTS idx_mcp_grant_key ON mcpKeyGrants(keyId)"],
  },
  kv: {
    columns: {
      scope: "TEXT NOT NULL",
      key: "TEXT NOT NULL",
      value: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (scope, key)",
    indexes: ["CREATE INDEX IF NOT EXISTS idx_kv_scope ON kv(scope)"],
  },
  usageHistory: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      timestamp: "TEXT NOT NULL",
      provider: "TEXT",
      model: "TEXT",
      connectionId: "TEXT",
      apiKey: "TEXT",
      endpoint: "TEXT",
      promptTokens: "INTEGER DEFAULT 0",
      completionTokens: "INTEGER DEFAULT 0",
      cachedTokens: "REAL NOT NULL DEFAULT 0",
      reasoningTokens: "REAL NOT NULL DEFAULT 0",
      cacheCreationTokens: "REAL NOT NULL DEFAULT 0",
      cost: "REAL DEFAULT 0",
      status: "TEXT",
      tokens: "TEXT",
      meta: "TEXT",
      usageEventId: "TEXT",
      // Wall-clock duration of the upstream call and its time to first token,
      // both in ms. Stored on the usage row so throughput aggregates per model,
      // account and key without joining requestDetails. 0 means "not timed":
      // rows written before this existed keep contributing tokens but no rate.
      latencyMs: "INTEGER NOT NULL DEFAULT 0",
      ttftMs: "INTEGER NOT NULL DEFAULT 0",
      // Per-rate split of `cost`, priced at insert where the request's own
      // long-context tier is known. NULL on rows written before this existed
      // and on provider-reported costs, which carry no rates to split with.
      inputCost: "REAL",
      cachedCost: "REAL",
      cacheCreationCost: "REAL",
      outputCost: "REAL",
      reasoningCost: "REAL",
      // Set only for requests dispatched through a combo after issue #747.
      // Existing rows remain NULL; never backfilled/inferred.
      comboId: "TEXT",
      comboName: "TEXT",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_uh_ts ON usageHistory(timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_uh_ts_dims ON usageHistory(timestamp, provider, model, connectionId, apiKey, endpoint)",
      "CREATE INDEX IF NOT EXISTS idx_uh_provider ON usageHistory(provider)",
      "CREATE INDEX IF NOT EXISTS idx_uh_model ON usageHistory(model)",
      "CREATE INDEX IF NOT EXISTS idx_uh_conn ON usageHistory(connectionId)",
      "CREATE INDEX IF NOT EXISTS idx_uh_combo ON usageHistory(comboId) WHERE comboId IS NOT NULL",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_uh_usage_event ON usageHistory(usageEventId) WHERE usageEventId IS NOT NULL",
      "CREATE INDEX IF NOT EXISTS idx_uh_apikey_ts ON usageHistory(apiKey, timestamp)",
    ],
  },
  usageLastSeen: {
    columns: {
      dateKey: "TEXT NOT NULL",
      provider: "TEXT NOT NULL",
      model: "TEXT NOT NULL",
      connectionId: "TEXT NOT NULL",
      apiKey: "TEXT NOT NULL",
      endpoint: "TEXT NOT NULL",
      lastUsed: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (dateKey, provider, model, connectionId, apiKey, endpoint)",
    indexes: ["CREATE INDEX IF NOT EXISTS idx_uls_date ON usageLastSeen(dateKey)"],
  },
  usageDaily: {
    columns: {
      dateKey: "TEXT PRIMARY KEY",
      data: "TEXT NOT NULL",
    },
  },
  // Aggregate Token Saver telemetry (port of 9router #2562). One row per
  // persisted logical request; `data` is the normalized event JSON. DB-native
  // autoincrement id — no caller/JS key. `timestamp` (ISO) backs today/24h/all
  // windows; `dateKey` backs inclusive local-calendar N-day windows.
  tokenSaverEvents: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      timestamp: "TEXT NOT NULL",
      dateKey: "TEXT NOT NULL",
      data: "TEXT NOT NULL",
      rtkRequestsWithHits: "REAL NOT NULL DEFAULT 0",
      rtkHits: "REAL NOT NULL DEFAULT 0",
      rtkBytesBefore: "REAL NOT NULL DEFAULT 0",
      rtkBytesAfter: "REAL NOT NULL DEFAULT 0",
      rtkBytesSaved: "REAL NOT NULL DEFAULT 0",
      hrTokensBefore: "REAL NOT NULL DEFAULT 0",
      hrTokensAfter: "REAL NOT NULL DEFAULT 0",
      hrTokensSaved: "REAL NOT NULL DEFAULT 0",
      hrBodyBytesBefore: "REAL NOT NULL DEFAULT 0",
      hrBodyBytesAfter: "REAL NOT NULL DEFAULT 0",
      hrPhantomSavings: "INTEGER NOT NULL DEFAULT 0",
      pxApplied: "INTEGER NOT NULL DEFAULT 0",
      pxTokensBeforeEst: "REAL NOT NULL DEFAULT 0",
      pxTokensAfterEst: "REAL NOT NULL DEFAULT 0",
      pxTokensSavedEst: "REAL NOT NULL DEFAULT 0",
      pxImageCount: "REAL NOT NULL DEFAULT 0",
      totalActualBytesSaved: "REAL NOT NULL DEFAULT 0",
      hrState: "TEXT NOT NULL DEFAULT 'disabled'",
      hrSkipReason: "TEXT",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_tse_ts ON tokenSaverEvents(timestamp)",
      "CREATE INDEX IF NOT EXISTS idx_tse_date ON tokenSaverEvents(dateKey)",
      "CREATE INDEX IF NOT EXISTS idx_tse_date_state ON tokenSaverEvents(dateKey, hrState)",
    ],
  },
  ...TOKEN_SAVER_DAILY_TABLES,
  requestDetails: {
    columns: {
      id: "TEXT PRIMARY KEY",
      timestamp: "TEXT NOT NULL",
      provider: "TEXT",
      model: "TEXT",
      connectionId: "TEXT",
      status: "TEXT",
      data: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_rd_ts ON requestDetails(timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_rd_provider ON requestDetails(provider)",
      "CREATE INDEX IF NOT EXISTS idx_rd_model ON requestDetails(model)",
      "CREATE INDEX IF NOT EXISTS idx_rd_conn ON requestDetails(connectionId)",
    ],
  },
  // Manual model capability overrides per provider/model target. The UI stores
  // targets in the same provider/model shape used by combos, so provider-specific
  // model caps do not leak across providers that expose the same model id.
  modelCapabilityOverrides: {
    columns: {
      provider: "TEXT NOT NULL",
      modelId: "TEXT NOT NULL",
      overrideKey: "TEXT NOT NULL",
      overrideValue: "TEXT NOT NULL",
      refreshedAt: "TEXT NOT NULL DEFAULT (datetime('now'))",
    },
    primaryKey: "PRIMARY KEY (provider, modelId, overrideKey)",
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_model_capability_overrides_key ON modelCapabilityOverrides(overrideKey)",
    ],
  },
  // ─── Opt-in PostgreSQL engine: cutover event log ──────────────────
  // Records every `cutover` / `rollback` / `test` event. The PG side
  // creates the same table via the parallel migration set; on SQLite
  // the schema is shared because the column types (`INTEGER`, `TEXT`,
  // `BOOLEAN` mapped to INTEGER) are compatible.
  pgCutoverLog: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      at: "TEXT NOT NULL DEFAULT (datetime('now'))",
      type: "TEXT NOT NULL",
      ok: "INTEGER NOT NULL",
      durationMs: "INTEGER",
      schemaVersion: "INTEGER",
      tablesMigrated: "INTEGER",
      rowsMigrated: "INTEGER",
      errorCode: "TEXT",
      errorMessage: "TEXT",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pgcl_at ON pgCutoverLog(at DESC)",
    ],
  },
};

export function buildCreateTableSql(name, def) {
  const cols = Object.entries(def.columns).map(([k, v]) => `${k} ${v}`);
  if (def.primaryKey) cols.push(def.primaryKey);
  return `CREATE TABLE IF NOT EXISTS ${name} (${cols.join(", ")})`;
}

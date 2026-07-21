import { QUOTA_V7_TABLES } from "./migrations/quota-v7-schema.js";
import { QUOTA_V8_TABLES } from "./migrations/quota-v8-schema.js";

// Latest schema version — bumped when a migration is added in ./migrations/
export const SCHEMA_VERSION = 12;

export const PRAGMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 30000000;
PRAGMA cache_size = -64000;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
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
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_combo_name ON combos(name)"],
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
      cost: "REAL DEFAULT 0",
      status: "TEXT",
      tokens: "TEXT",
      meta: "TEXT",
      usageEventId: "TEXT",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_uh_ts ON usageHistory(timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_uh_provider ON usageHistory(provider)",
      "CREATE INDEX IF NOT EXISTS idx_uh_model ON usageHistory(model)",
      "CREATE INDEX IF NOT EXISTS idx_uh_conn ON usageHistory(connectionId)",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_uh_usage_event ON usageHistory(usageEventId) WHERE usageEventId IS NOT NULL",
    ],
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
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_tse_ts ON tokenSaverEvents(timestamp)",
      "CREATE INDEX IF NOT EXISTS idx_tse_date ON tokenSaverEvents(dateKey)",
    ],
  },
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
  // Lifetime per-API-key usage rollup used by maxTokens/maxCostUsd policy
  // enforcement (see src/lib/db/repos/apiKeyUsageTotalsRepo.js). Declared in
  // TABLES so syncSchemaFromTables creates it on fresh DBs AND re-adds it on
  // upgrades where the table was never declared previously. The columns here
  // mirror what the 006-api-key-policy migration backfills from usageHistory.
  apiKeyUsageTotals: {
    columns: {
      apiKeyId: "TEXT PRIMARY KEY",
      totalTokens: "INTEGER DEFAULT 0",
      totalCost: "REAL DEFAULT 0",
      totalRequests: "INTEGER DEFAULT 0",
      updatedAt: "TEXT",
    },
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
};

export function buildCreateTableSql(name, def) {
  const cols = Object.entries(def.columns).map(([k, v]) => `${k} ${v}`);
  if (def.primaryKey) cols.push(def.primaryKey);
  return `CREATE TABLE IF NOT EXISTS ${name} (${cols.join(", ")})`;
}

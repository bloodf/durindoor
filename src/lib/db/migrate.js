import fs from "node:fs";
import path from "node:path";
import { currentDataFile, currentDbDir, currentLegacyFiles } from "./paths.js";
import { TABLES, buildCreateTableSql } from "./schema.js";
import { MIGRATIONS, latestVersion } from "./migrations/index.js";
import { getMetaSync, setMetaSync } from "./helpers/metaStore.js";
import { makeBackupDir, backupFile, backupDbLite, pruneOldBackups } from "./backup.js";
import { getAppVersion } from "./version.js";
import { stringifyJson } from "./helpers/jsonCol.js";
import { backfillApiKeyUsageTotals } from "./helpers/apiKeyUsageTotals.js";
import { quotaStorageNeedsAdditiveRepair, verifyPublishedSchemaShapes } from "./helpers/schemaVerifier.js";
import { canonicalizeApiKeyExpiresAt } from "../../shared/utils/apiKeyExpiry.js";

// Marker file: prevents re-importing legacy JSON when user wipes data.sqlite.
const migratedMarkerFile = () => path.join(currentDbDir(), ".migrated-from-json");

// Track per-adapter so reusing same adapter skips re-run, but new adapter (after reset) re-runs.
const _migratedAdapters = new WeakSet();

// Thrown when row-count assertion fails. Outer transaction rolls back,
// legacy db.json kept intact, marker not written → next boot retries.
export class MigrationAborted extends Error {
  constructor(message, droppedRows) {
    super(message);
    this.name = "MigrationAborted";
    this.droppedRows = droppedRows;
  }
}

// Insert rows one-by-one, collect failures, then assert COUNT(*) matches input length.
function importWithAssertion(adapter, tableName, rows, insertFn, rowMeta) {
  const dropped = [];
  for (const row of rows) {
    try { insertFn(row); }
    catch (err) { dropped.push({ ...rowMeta(row), reason: err.message }); }
  }
  const inserted = adapter.get(`SELECT COUNT(*) as c FROM ${tableName}`)?.c ?? 0;
  if (inserted !== rows.length) {
    console.warn(`[DB][migrate] ${tableName} row-count mismatch: expected ${rows.length}, got ${inserted}. Dropped:`, dropped);
    throw new MigrationAborted(`${tableName} row-count mismatch: expected ${rows.length}, got ${inserted}`, dropped);
  }
}

function readJsonSafe(file) {
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return null; }
}

function isFreshDb(adapter) {
  // Table _meta may not exist yet on truly fresh DB
  try {
    const row = adapter.get(`SELECT COUNT(*) as c FROM _meta`);
    return !row || row.c === 0;
  } catch {
    return true;
  }
}

// ─── Versioned migrations runner (skip-version safe) ─────────────────────
function runVersionedMigrations(adapter) {
  // Bootstrap _meta first so we can read schemaVersion
  adapter.exec(buildCreateTableSql("_meta", TABLES._meta));

  const current = parseInt(getMetaSync(adapter, "schemaVersion", "0"), 10) || 0;
  const target = latestVersion();
  if (current >= target) return { applied: 0, from: current, to: current };

  const pending = MIGRATIONS.filter((m) => m.version > current);
  let lastApplied = current;
  for (const m of pending) {
    adapter.transaction(() => {
      m.up(adapter);
      setMetaSync(adapter, "schemaVersion", m.version);
    });
    lastApplied = m.version;
    console.log(`[DB][migrate] applied #${m.version} ${m.name}`);
  }
  return { applied: pending.length, from: current, to: lastApplied };
}

// ─── Auto-sync (additive only): add missing tables/columns/indexes ───────
function syncSchemaFromTables(adapter) {
  for (const [tableName, def] of Object.entries(TABLES)) {
    // Create table if absent
    adapter.exec(buildCreateTableSql(tableName, def));

    // Diff columns
    const existing = adapter.all(`PRAGMA table_info(${tableName})`);
    const existingNames = new Set(existing.map((r) => r.name));
    for (const [colName, colDef] of Object.entries(def.columns)) {
      if (!existingNames.has(colName)) {
        // SQLite ADD COLUMN restrictions: no PRIMARY KEY / UNIQUE w/o NULL ok.
        // We strip PRIMARY KEY / UNIQUE since those are only valid at create time.
        const safeDef = colDef
          .replace(/PRIMARY KEY( AUTOINCREMENT)?/i, "")
          .replace(/UNIQUE/i, "")
          .trim();
        try {
          adapter.exec(`ALTER TABLE ${tableName} ADD COLUMN ${colName} ${safeDef}`);
          console.log(`[DB][sync] +column ${tableName}.${colName}`);
        } catch (e) {
          console.warn(`[DB][sync] add column ${tableName}.${colName} failed: ${e.message}`);
        }
      }
    }

    // Indexes (idempotent)
    for (const idx of def.indexes || []) {
      try { adapter.exec(idx); } catch {}
    }
  }
}

// ─── Legacy JSON import (one-time) ───────────────────────────────────────
function importLegacyMain(adapter, data) {
  if (!data || typeof data !== "object") return;

  if (data.settings) {
    adapter.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, [stringifyJson(data.settings)]);
  }

  importWithAssertion(adapter, "providerConnections", data.providerConnections || [], (c) => {
    const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
    adapter.run(
      `INSERT OR REPLACE INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, provider, authType || "oauth", name || null, email || null, priority || null, isActive === false ? 0 : 1, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
    );
  }, (c) => ({ id: c.id ?? null, provider: c.provider ?? null, name: c.name ?? null }));

  importWithAssertion(adapter, "providerNodes", data.providerNodes || [], (n) => {
    const { id, type, name, createdAt, updatedAt, ...rest } = n;
    adapter.run(
      `INSERT OR REPLACE INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
      [id, type || null, name || null, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
    );
  }, (n) => ({ id: n.id ?? null, type: n.type ?? null, name: n.name ?? null }));

  importWithAssertion(adapter, "proxyPools", data.proxyPools || [], (p) => {
    const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
    adapter.run(
      `INSERT OR REPLACE INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
      [id, isActive === false ? 0 : 1, testStatus || "unknown", stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
    );
  }, (p) => ({ id: p.id ?? null }));

  importWithAssertion(adapter, "apiKeys", data.apiKeys || [], (k) => {
    adapter.run(
      `INSERT OR REPLACE INTO apiKeys(id, key, name, machineId, isActive, allowedCombos, dailyLimitTokens, policy, expiresAt, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [k.id, k.key, k.name || null, k.machineId || null, k.isActive === false ? 0 : 1, JSON.stringify(k.allowedCombos || []), k.dailyLimitTokens ?? null, k.policy == null ? null : stringifyJson(k.policy), canonicalizeApiKeyExpiresAt(k.expiresAt ?? null), k.createdAt || new Date().toISOString()]
    );
  }, (k) => ({ id: k.id ?? null, name: k.name ?? null }));

  importWithAssertion(adapter, "combos", data.combos || [], (c) => {
    adapter.run(
      `INSERT OR REPLACE INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
      [c.id, c.name, c.kind || null, stringifyJson(c.models || []), c.createdAt || new Date().toISOString(), c.updatedAt || new Date().toISOString()]
    );
  }, (c) => ({ id: c.id ?? null, name: c.name ?? null }));

  for (const [alias, model] of Object.entries(data.modelAliases || {})) {
    adapter.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('modelAliases', ?, ?)`, [alias, stringifyJson(model)]);
  }
  for (const m of data.customModels || []) {
    const k = `${m.providerAlias}|${m.id}|${m.type || "llm"}`;
    adapter.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [k, stringifyJson(m)]);
  }
  for (const [tool, mappings] of Object.entries(data.mitmAlias || {})) {
    adapter.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('mitmAlias', ?, ?)`, [tool, stringifyJson(mappings || {})]);
  }
  for (const [provider, models] of Object.entries(data.pricing || {})) {
    adapter.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('pricing', ?, ?)`, [provider, stringifyJson(models || {})]);
  }
}

function importLegacyUsage(adapter, data) {
  if (!data || typeof data !== "object") return;
  for (const e of data.history || []) {
    const t = e.tokens || {};
    adapter.run(
      `INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        e.timestamp || new Date().toISOString(),
        e.provider || null, e.model || null, e.connectionId || null, e.apiKey || null, e.endpoint || null,
        t.prompt_tokens || t.input_tokens || 0,
        t.completion_tokens || t.output_tokens || 0,
        e.cost || 0,
        e.status || "ok",
        stringifyJson(t),
        stringifyJson({}),
      ]
    );
  }
  for (const [dateKey, day] of Object.entries(data.dailySummary || {})) {
    adapter.run(`INSERT OR REPLACE INTO usageDaily(dateKey, data) VALUES(?, ?)`, [dateKey, stringifyJson(day)]);
  }
  if (typeof data.totalRequestsLifetime === "number") {
    setMetaSync(adapter, "totalRequestsLifetime", data.totalRequestsLifetime);
  }
}

function importLegacyDisabled(adapter, data) {
  if (!data || typeof data.disabled !== "object") return;
  for (const [provider, ids] of Object.entries(data.disabled)) {
    adapter.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('disabledModels', ?, ?)`, [provider, stringifyJson(ids || [])]);
  }
}

function importLegacyDetails(adapter, data) {
  if (!data || !Array.isArray(data.records)) return;
  for (const r of data.records) {
    adapter.run(
      `INSERT OR REPLACE INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?)`,
      [r.id, r.timestamp || new Date().toISOString(), r.provider || null, r.model || null, r.connectionId || null, r.status || null, stringifyJson(r)]
    );
  }
}

// ─── Main entry ──────────────────────────────────────────────────────────
export async function runMigrationOnce(adapter) {
  if (_migratedAdapters.has(adapter)) return;

  // Capture freshness BEFORE migrations stamp _meta (otherwise we'd misclassify
  // a brand-new DB as non-fresh once schemaVersion is written).
  const fresh = isFreshDb(adapter);
  const markerFile = migratedMarkerFile();
  const legacyFiles = currentLegacyFiles();
  const alreadyImported = fs.existsSync(markerFile);
  const legacyMain = readJsonSafe(legacyFiles.main);
  const legacyUsage = readJsonSafe(legacyFiles.usage);
  const legacyDisabled = readJsonSafe(legacyFiles.disabled);
  const legacyDetails = readJsonSafe(legacyFiles.details);
  const hasLegacy = !!(legacyMain || legacyUsage || legacyDisabled || legacyDetails);

  // Validate legacy expiry before backups, migration stamps, or table changes.
  // A corrected db.json can then be retried against the same still-fresh DB.
  if (fresh && hasLegacy && !alreadyImported) {
    for (const key of legacyMain?.apiKeys || []) {
      canonicalizeApiKeyExpiresAt(key.expiresAt ?? null);
    }
  }

  // Snapshot the existing database before any schema mutation. WAL-backed
  // adapters must checkpoint first or the copied data.sqlite may omit committed
  // pages that still live in the sidecar file.
  const oldSchemaVersion = fresh ? 0 : parseInt(getMetaSync(adapter, "schemaVersion", "0"), 10) || 0;
  const oldAppVersion = fresh ? null : getMetaSync(adapter, "appVersion", null);
  const newAppVersion = getAppVersion();
  const needsSchemaUpgrade = !fresh && oldSchemaVersion < latestVersion();
  const needsAppBackup = !fresh && oldAppVersion && oldAppVersion !== newAppVersion;
  // Earlier PR145 heads could stamp v6 while the policy migration silently
  // skipped a missing totals table. Repair that exact structural state once;
  // never rebuild an existing table because it also contains non-chat usage.
  const needsTotalsRepair = !fresh
    && oldSchemaVersion >= 6
    && adapter.all(`PRAGMA table_info(apiKeyUsageTotals)`).length === 0;
  // A previously interrupted/unreleased v7 build may have stamped the version
  // without both durable quota tables. Repair only absence; incompatible
  // partial shapes are rejected by verifyPublishedSchemaShapes below.
  const useLatestQuotaSchema = oldSchemaVersion >= 8;
  const needsQuotaRepair = !fresh
    && oldSchemaVersion >= 7
    && quotaStorageNeedsAdditiveRepair(adapter, { useLatest: useLatestQuotaSchema });
  // A database already stamped at the current quota schema is checked against
  // that immutable shape before backup or additive sync. Missing objects may be
  // repaired, but incompatible constraints never get mutated first.
  // Validate every quota object that already exists, including prematurely
  // created v8 tables on a v7 stamp. Completeness is still deferred until the
  // migration/sync pass, but incompatible objects must fail before backup,
  // version stamping, or any mutation.
  verifyPublishedSchemaShapes(adapter, { useLatestQuotaSchema: true });
  let preUpgradeBackupDir = null;
  if (needsSchemaUpgrade || needsAppBackup || needsTotalsRepair || needsQuotaRepair) {
    // Strict checkpoint: adapters propagate SQL errors and reject a busy WAL.
    // Migration must stop before copying or mutating if committed pages cannot
    // be proven present in data.sqlite.
    if (adapter.checkpoint) await adapter.checkpoint();
    const label = needsSchemaUpgrade
      ? `schema-${oldSchemaVersion}-to-${latestVersion()}`
      : needsTotalsRepair
        ? `schema-${oldSchemaVersion}-totals-repair`
        : needsQuotaRepair
          ? `schema-${oldSchemaVersion}-quota-repair`
        : `upgrade-${oldAppVersion}-to-${newAppVersion}`;
    preUpgradeBackupDir = makeBackupDir(label);
    const source = currentDataFile();
    // Schema upgrades use a lightweight ATTACH backup that skips the huge
    // requestDetails observability log; app-version/totals-repair keep a full
    // file copy. If the adapter cannot ATTACH (in-memory sql.js) or the lite
    // copy fails, fall back to a full copy so the safety net always exists.
    let copied = null;
    if (needsSchemaUpgrade) {
      copied = backupDbLite(adapter, preUpgradeBackupDir);
    }
    if (!copied) {
      copied = backupFile(source, preUpgradeBackupDir);
    }
    if (fs.existsSync(source) && !copied) {
      throw new Error(`[DB][migrate] failed to create pre-upgrade backup for ${source}`);
    }
  }

  // 1. Always run versioned migrations chain (skip-version safe)
  const migInfo = runVersionedMigrations(adapter);

  // 2. Additive sync (auto add missing columns/indexes declared in TABLES)
  syncSchemaFromTables(adapter);
  verifyPublishedSchemaShapes(adapter, { requireQuotaComplete: true, useLatestQuotaSchema: true });
  if (needsTotalsRepair) backfillApiKeyUsageTotals(adapter);

  // 3. One-time legacy JSON import (only if DB was fresh on entry)
  if (fresh && hasLegacy && !alreadyImported) {
    const t0 = Date.now();
    const backupDir = makeBackupDir("migrate-from-json");
    for (const f of Object.values(legacyFiles)) backupFile(f, backupDir);

    try {
      adapter.transaction(() => {
        importLegacyMain(adapter, legacyMain);
        importLegacyUsage(adapter, legacyUsage);
        backfillApiKeyUsageTotals(adapter);
        importLegacyDisabled(adapter, legacyDisabled);
        importLegacyDetails(adapter, legacyDetails);
        setMetaSync(adapter, "appVersion", getAppVersion());
        setMetaSync(adapter, "migratedAt", new Date().toISOString());
      });
    } catch (err) {
      if (err instanceof MigrationAborted) {
        console.error(`[DB][migrate] aborted: ${err.message} | legacy JSON kept | backup: ${backupDir}`);
        return;
      }
      throw err;
    }

    try { fs.writeFileSync(markerFile, new Date().toISOString()); } catch {}
    pruneOldBackups();
    console.log(`[DB][migrate] JSON → SQLite in ${Date.now() - t0}ms | legacy JSON kept at DATA_DIR | backup: ${backupDir}`);
    _migratedAdapters.add(adapter);
    return;
  }

  if (fresh) {
    setMetaSync(adapter, "appVersion", getAppVersion());
    _migratedAdapters.add(adapter);
    return;
  }

  // 4. Stamp the app version only after migrations succeed. Any required
  // safety copy was created above, before the first schema mutation.
  if (!oldAppVersion) setMetaSync(adapter, "appVersion", newAppVersion);
  if (oldAppVersion && oldAppVersion !== newAppVersion) {
    setMetaSync(adapter, "appVersion", newAppVersion);
    pruneOldBackups();
    console.log(`[DB][migrate] App ${oldAppVersion} → ${newAppVersion} | schema ${migInfo.from} → ${migInfo.to} | backup: ${preUpgradeBackupDir}`);
  } else if (migInfo.applied > 0 || needsTotalsRepair || needsQuotaRepair) {
    pruneOldBackups();
    const repair = needsTotalsRepair
      ? " | repaired API-key totals"
      : needsQuotaRepair
        ? " | repaired quota storage"
        : "";
    console.log(`[DB][migrate] Schema ${migInfo.from} → ${migInfo.to}${repair} | backup: ${preUpgradeBackupDir}`);
  }
  _migratedAdapters.add(adapter);
}

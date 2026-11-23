import { getAdapter, getAdapterSync } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { isBoolean, isFunction, isRecord, isString } from "../../../shared/utils/typeChecks.js";

const DEFAULT_MITM_ROUTER_BASE = "http://localhost:20128";
const DEFAULT_HEADROOM_URL = process.env.HEADROOM_URL || "http://localhost:8787";

const DEFAULT_QUOTA_TRACKER_STATE = {
  providerFilter: "all",
  accountFilter: "all",
  quotaSortMode: "default",
  expiringFirst: false,
  pageSize: 20,
  page: 1
};

const DEFAULT_SETTINGS = {
  // Session message capture requires explicit operator opt-in and request consent.
  enableSessionCapture: false,
  cloudEnabled: false,
  hidePaidModels: false,
  exposeComboOnly: false,
  /**
   * OmniRoute #11481 (port(omniroute)): operator glob allow/deny list for
   * /v1/models exposure, mirrored into auto/* combo candidate pools.
   * Default off (empty arrays); see src/shared/utils/modelExposureList.js.
   */
  modelVisibilityAllowlist: [],
  modelVisibilityDenylist: [],
  tunnelEnabled: false,
  tunnelUrl: "",
  tunnelProvider: "cloudflare",
  tailscaleEnabled: false,
  tailscaleUrl: "",
  stickyRoundRobinLimit: 3,
  /**
   * Per-provider static retry delay in seconds (decolua/9router#2895).
   * Missing providers retain provider-reset or configured backoff behavior.
   */
  retryDelayByProvider: {},
  /** Per-provider per-account RPM overrides (decolua/9router#3203); zero means unlimited. */
  rpmByProvider: {},
  /**
   * Operator-declared per-provider error rules (OmniRoute #11104), consulted
   * before the built-in providerRuleRegistry (open-sse/config/providerErrorRules.js).
   * Keyed by lowercase provider id: [{ status, match, scope, reason?, cooldownMs? }].
   */
  providerErrorRules: {},
  /**
   * OmniRoute #10920: providers whose upstream quota is bucketed by egress
   * IP rather than by account. A 429 on one connection cools every sibling
   * connection assigned to the same proxy pool (src/sse/services/auth.js
   * applyEgressBucketCooldown). Empty by default -- opt-in per provider id.
   */
  egressBucketedProviders: [],
  providerStrategies: {},
  quotaVisibility: {},
  comboStrategy: "fallback",
  comboStickyRoundRobinLimit: 1,
  comboStrategies: {},
  comboPrompts: {},
  // Dashboard update checks and prompts are enabled for new and legacy settings.
  showUpdateNotifications: true,
  requireLogin: true,
  tunnelDashboardAccess: true,
  authMode: "password",
  oidcIssuerUrl: "",
  oidcClientId: "",
  oidcClientSecret: "",
  oidcScopes: "openid profile email",
  oidcLoginLabel: "Sign in with OIDC",
  // OIDC operator allowlists (#2195). All empty = OIDC login is refused.
  // Email/domain entries only match ids with email_verified === true.
  oidcAllowedSubjects: [],
  oidcAllowedEmails: [],
  oidcAllowedDomains: [],
  // TOTP dashboard 2FA (decolua/9router#4144). mfaSecret/mfaBackupCodes are
  // credentials -- see SECRET_SETTING_KEYS in settingsPatchAuth.js and the
  // GET/PATCH redaction in the settings route; they must never round-trip
  // through the generic settings API.
  mfaEnabled: false,
  mfaSecret: "",
  mfaBackupCodes: [],
  passwordSessionEpoch: "initial",
  enableObservability: true,
  logToolSources: false,
  enableProxyTimeline: false,
  proxyTimelineRetentionDays: 1,
  /** Automatic cleanup of usage, request details, timeline and quota history older than N days. */
  dataRetentionEnabled: false,
  dataRetentionDays: 30,
  /**
   * Model auto-sync (src/lib/modelAutoSync): hours between provider model
   * catalog refreshes, 0 = off. modelAutoSyncProviders holds per-provider
   * on/off overrides; providers not listed use MODEL_AUTO_SYNC_DEFAULT_PROVIDERS.
   */
  modelAutoSyncIntervalHours: 24,
  modelAutoSyncProviders: {},
  /**
   * Opt-in: after a successful, non-empty model sync of a provider, move combo
   * steps whose model left that provider's live catalog to the combo's
   * prunedSteps (restorable from the combo editor). Off by default.
   */
  autoPruneStaleComboSteps: false,
  observabilityMaxRecords: 1000,
  observabilityBatchSize: 20,
  observabilityFlushIntervalMs: 5000,
  outboundProxyEnabled: false,
  outboundProxyUrl: "",
  outboundNoProxy: "",
  firecrawlBaseUrl: "",
  mitmRouterBaseUrl: DEFAULT_MITM_ROUTER_BASE,
  dnsToolEnabled: {},
  rtkEnabled: true,
  headroomEnabled: false,
  headroomUrl: DEFAULT_HEADROOM_URL,
  headroomCompressUserMessages: false,
  headroomTimeoutMs: 15000,
  pxpipeEnabled: true,
  pxpipeMinChars: 25000,
  pxpipeTimeoutMs: 15000,
  pxpipeAllowedModels: [],
  providerConcurrencyLimits: {},
  // Hierarchical concurrency admission: caps in-flight upstream requests
  // across every provider combined, above the per-provider caps in
  // providerConcurrencyLimits. 0 = unlimited (no global gate).
  globalConcurrentRequests: 0,
  // fallbackStrategy: "quota-weighted" pool-floor split (percent). Accounts
  // at or below this leftover-quota percent only get drawn from when every
  // comparable account is already that thin.
  quotaWeightedFloorPercent: 1,
  // Optional upstream routing overrides. Shape:
  // { [providerId]: { enabled, mode: "native"|"cliproxyapi"|"fallback", cliproxyapiModelMapping } }
  upstreamProxyConfig: {},
  cliproxyapi_fallback_codes: "429,500,502,503,504",
  // Vision Bridge (OmniRoute #6640): reroute image-bearing requests on a
  // non-vision model to a configured vision-capable target. Requires an
  // explicit, vision-capable visionBridgeModel; an empty/invalid target leaves
  // the request on its original model (no unsafe auto-pick to a provider the
  // caller may not have credentials for).
  visionBridgeEnabled: false,
  visionBridgeModel: "",
  // Claude Code auto-mode classifier compat: "off" | "auto" | "always".
  // When enabled, classifier requests are short-circuited to "<block>no</block>"
  // (ALLOW) and `thinking` blocks are suppressed on Claude-shaped responses.
  claudeClassifierCompat: "off",
  // Compression engine stack (F-1b). Master switch is off by default; enabling
  // runs the configured engine(s) after RTK/headroom and before caveman/pxpipe.
  // compressionEngines is a per-id toggle map: { [engineId]: { enabled, level? } }.
  // Any engine throw fail-opens and restores the body; the loop never throws.
  compressionEnabled: false,
  compressionEngines: {},
  // Opt-in outbound PII / credential masking (#1112): mode "off" | "warn" | "mask".
  contentMasking: { mode: "off", credentials: true, pii: true },
  // Opt-in text fidelity gate for stack steps (numbers, URLs, JSON keys,
  // negations). Protected blocks are always gated; see fidelityGate.js.
  compressionFidelityGate: false,
  // Context-budget adaptive escalation for the stack (#1100). mode "off" |
  // "floor" | "replace-autotrigger"; see adaptiveCompression/types.js.
  compressionAdaptive: { mode: "off" },
  cavemanEnabled: false,
  cavemanLevel: "full",
  quotaTrackerState: DEFAULT_QUOTA_TRACKER_STATE,
  ponytailEnabled: false,
  ponytailLevel: "full",
  // User-authored system prompt, injected independently of the built-in savers.
  customPromptEnabled: false,
  customPrompt: "",
  // Default: free no-auth providers remain enabled unless the user explicitly
  // disables them via Settings > Providers.
  disabledFreeProviders: [],
  // #10372: opt-in only — fresh installs (or rows missing the persisted
  // key) must not run in debug mode; a persisted `true` is preserved.
  debugMode: false,
  // #2025: opt-in LAN discovery of Ollama / OpenAI-compatible endpoints.
  // Off by default; POST /api/providers/lan-discovery returns 403 until enabled.
  lanDiscoveryEnabled: false,
  // ─── Opt-in PostgreSQL engine (issue: feat/postgres-engine) ──────────
  // The runtime is SQLite by default. PG is opt-in; when the operator
  // supplies a connection URL and runs a successful cutover, this flips
  // to `"postgres"`. The `databaseEngineError` field surfaces the last
  // boot-time fallback event (string, nullable).
  databaseEngine: "sqlite",
  databaseEngineError: null,
  databaseCutoverAt: null,
  databaseCutoverSchemaVersion: null,
  // Cap on which major version the runtime will treat as the floor for
  // feature adoption. Valid values: 16, 17, 18. The cluster's actual
  // major version is read at boot; if it is below the cap, the runtime
  // auto-disables features with `requires > clusterMajor` and records a
  // warning in `databaseEngineError`.
  databasePgVersion: 18,
  // Per-feature toggle map. Each entry is `{ enabled, requires: ">=N" }`.
  // The runtime computes `effectiveEnabled = enabled && clusterMajor >= N`
  // and surfaces the effective state on the settings page. See
  // `src/lib/db/postgresCapabilityGate.js` for the canonical enumeration.
  databasePgFeatures: {
    jsonTable:            { enabled: true,  requires: ">=17" },
    mergeReturning:       { enabled: true,  requires: ">=17" },
    copyOnError:          { enabled: true,  requires: ">=17" },
    sslnegotiationDirect: { enabled: true,  requires: ">=17" },
    incrementalBackup:    { enabled: true,  requires: ">=17" },
    streamingIo:          { enabled: true,  requires: ">=17" },
    vacuumMemoryOpt:      { enabled: true,  requires: ">=17" },
    notNullElimination:   { enabled: true,  requires: ">=17" },
    inBtreeOpt:           { enabled: true,  requires: ">=17" },
    parallelGin:          { enabled: true,  requires: ">=17" },
    aio:                  { enabled: true,  requires: ">=18" },
    skipScan:             { enabled: true,  requires: ">=18" },
    logLockWaits:         { enabled: true,  requires: ">=18" },
    pgUpgradeSwap:        { enabled: true,  requires: ">=18" },
    plannerStatsPreserved:{ enabled: true,  requires: ">=18" },
    uuidv7:               { enabled: false, requires: ">=18" },
    onConflictDoSelect:   { enabled: false, requires: ">=19" },
    forPortionOf:         { enabled: false, requires: ">=19" },
    waitForLsn:           { enabled: false, requires: ">=19" },
    pgPlanAdvice:         { enabled: false, requires: ">=19" },
    parallelAutovacuum:   { enabled: false, requires: ">=19" },
    repack:               { enabled: false, requires: ">=19" },
    onlineChecksumToggle: { enabled: false, requires: ">=19" },
  },
  // Redacted connection info for the UI display. The actual URL (with
  // password) is held in `DATA_DIR/durindoor-secrets.json` (mode 0600)
  // or in the env var `DURINDOOR_PG_URL`. These fields are only the
  // non-secret parts.
  postgresHost: "",
  postgresPort: 5432,
  postgresDatabase: "",
  postgresUser: "",
  postgresSslmode: "prefer",
  postgresAuthSource: "settings", // or "env"
};

function migrateObservabilityKeys(raw) {
  const next = { ...(raw || {}) };
  const hasCanonical = Object.prototype.hasOwnProperty.call(next, "enableObservability");
  const hasLegacy = Object.prototype.hasOwnProperty.call(next, "enableObservability2");
  if (!hasCanonical && hasLegacy && isBoolean(next.enableObservability2)) {
    next.enableObservability = next.enableObservability2;
  }
  delete next.enableObservability2;
  return next;
}

/**
 * Merge a partial `compressionEngines` write over the stored toggle map.
 *
 * The compression stack is configured by one per-engine map
 * ({ [engineId]: { enabled, level?, ...engine options } }) stored in a single
 * settings field. A write that carries only the engine it changed used to
 * replace that whole map, so a toggle on one surface silently dropped every
 * sibling engine -- and every sibling's options -- the writer had not loaded.
 * OmniRoute #15613 fixes the same loss in the upstream compression store;
 * this is the fork's equivalent, applied to the fork's own settings field.
 *
 * Merge rules:
 *   - engines the write does not mention are kept exactly as stored;
 *   - an engine the write does mention is merged field by field, so a write
 *     that only flips `enabled` keeps the stored `level` and the stored
 *     per-engine options (lite's truncateToolResults / maxToolLength);
 *   - an explicit `null` engine removes that engine; a null property is stored.
 *
 * New engine IDs can be added; dispatch still gates unavailable catalog engines
 * on isEngineAvailable().
 *
 * @param {unknown} stored the currently stored `compressionEngines` value
 * @param {unknown} incoming the incoming `compressionEngines` value
 * @returns {Record<string, unknown>} the merged map
 */
export function mergeCompressionEngines(stored, incoming) {
  const base = isRecord(stored) ? stored : {};
  // A non-map write carries no engine information: keep what is stored
  // instead of replacing the map with something unreadable.
  if (!isRecord(incoming)) return { ...base };
  const merged = { ...base };
  for (const [id, entry] of Object.entries(incoming)) {
    if (entry === null) {
      delete merged[id];
      continue;
    }
    const baseEntry = isRecord(base[id]) ? base[id] : {};
    merged[id] = isRecord(entry) ? { ...baseEntry, ...entry } : entry;
  }
  return merged;
}

/**
 * Apply the compression-engines merge to a settings patch. Only a patch that
 * actually carries `compressionEngines` is touched; every other key keeps the
 * plain top-level replace semantics.
 */
function applyCompressionEnginesMerge(current, updates) {
  if (!Object.prototype.hasOwnProperty.call(updates, "compressionEngines")) return updates;
  return {
    ...updates,
    compressionEngines: mergeCompressionEngines(current?.compressionEngines, updates.compressionEngines),
  };
}

async function readRaw() {
  const db = await getAdapter();
  const row = db.get(`SELECT data FROM settings WHERE id = 1`);
  const parsed = row ? parseJson(row.data, {}) : {};
  const migrated = migrateObservabilityKeys(parsed);
  if (Object.prototype.hasOwnProperty.call(parsed, "enableObservability2")) {
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [stringifyJson(migrated)]
    );
  }
  return migrated;
}


function readRawSync() {
  const db = getAdapterSync();
  const row = db.get(`SELECT data FROM settings WHERE id = 1`);
  const parsed = row ? parseJson(row.data, {}) : {};
  const migrated = migrateObservabilityKeys(parsed);
  if (Object.prototype.hasOwnProperty.call(parsed, "enableObservability2")) {
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [stringifyJson(migrated)]
    );
  }
  return migrated;
}

export function getSettingsSync() {
  return mergeWithDefaults(readRawSync());
}

// Merge raw settings with defaults; backward-compat for missing keys
function mergeWithDefaults(raw) {
  const merged = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  merged.quotaTrackerState = {
    ...DEFAULT_QUOTA_TRACKER_STATE,
    ...((raw || {}).quotaTrackerState || {})
  };
  for (const [key, defVal] of Object.entries(DEFAULT_SETTINGS)) {
    if (merged[key] !== undefined) continue;
    if (
    key === "outboundProxyEnabled" && isString(
      merged.outboundProxyUrl) &&
    merged.outboundProxyUrl.trim())
    {
      merged[key] = true;
    } else {
      merged[key] = defVal;
    }
  }
  return merged;
}

export async function getSettings() {
  const raw = await readRaw();
  return mergeWithDefaults(raw);
}

// Atomic read-merge-write inside transaction (prevents losing concurrent updates).
// `updates` may be a function of the stored settings, for merges into a nested
// key that must see the row as it is inside the transaction.
export async function updateSettings(updates) {
  const db = await getAdapter();
  let next;
  db.transaction(() => {
    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    const current = migrateObservabilityKeys(row ? parseJson(row.data, {}) : {});
    const resolved = isFunction(updates) ? updates(current) : updates;
    const { enableObservability2: _legacyObservability, ...sanitizedUpdates } = resolved;
    next = migrateObservabilityKeys({
      ...current,
      ...applyCompressionEnginesMerge(current, sanitizedUpdates),
    });
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [stringifyJson(next)]
    );
  });
  return mergeWithDefaults(next);
}
export class PasswordEpochMismatchError extends Error {
  constructor() {
    super("password session epoch changed");
    this.code = "PASSWORD_EPOCH_MISMATCH";
  }
}

// Atomic CAS write for password mutations. Re-reads the row inside the
// same transaction; if the row's passwordSessionEpoch no longer matches
// `expectedEpoch`, the merge is aborted and the caller must retry instead
// of clobbering a concurrent rotation.
export async function updateSettingsWithPasswordEpoch(updates, expectedEpoch) {
  const { enableObservability2: _legacyObservability, ...sanitizedUpdates } = updates;
  const db = await getAdapter();
  let next;
  let matched = false;
  db.transaction(() => {
    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    const current = migrateObservabilityKeys(row ? parseJson(row.data, {}) : {});
    if ((current.passwordSessionEpoch ?? "initial") !== expectedEpoch) {
      matched = false;
      return;
    }
    matched = true;
    next = migrateObservabilityKeys({
      ...current,
      ...applyCompressionEnginesMerge(current, sanitizedUpdates),
    });
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [stringifyJson(next)]
    );
  });
  if (!matched) throw new PasswordEpochMismatchError();
  return mergeWithDefaults(next);
}

/**
 * Atomically match a candidate MFA backup code against the currently stored
 * hashes and, on a match, remove only that one hash -- read, match, and write
 * inside a single transaction (decolua/9router#4144 TOCTOU fix).
 *
 * The naive version (getSettings, then an async bcrypt.compare loop, then
 * updateSettings) reads the array before the compare loop's await points and
 * writes after them, so two concurrent verifications can both match the same
 * pre-write array and each independently persist their own "minus one hash"
 * result -- the loser's write clobbers the winner's, and the consumed code
 * is still valid. Reading fresh state inside the same transaction that
 * performs the write closes that window.
 *
 * `matchFn` MUST be synchronous (see backupCodes.js `findBackupCodeHashIndexSync`):
 * an `await` inside the transaction body would reopen exactly this race.
 *
 * @param {string} candidate raw user input, not yet normalized
 * @param {(candidate: string, hashes: string[]) => number} matchFn returns the matching index, or -1
 * @returns {Promise<{ matched: boolean, backupCodesRemaining: number }>}
 */
export async function consumeBackupCodeAtomic(candidate, matchFn) {
  const db = await getAdapter();
  let result = { matched: false, backupCodesRemaining: 0 };
  db.transaction(() => {
    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    const current = migrateObservabilityKeys(row ? parseJson(row.data, {}) : {});
    const hashes = Array.isArray(current.mfaBackupCodes) ? current.mfaBackupCodes : [];
    const index = matchFn(candidate, hashes);
    if (index === -1) {
      result = { matched: false, backupCodesRemaining: hashes.length };
      return;
    }
    const remaining = hashes.slice(0, index).concat(hashes.slice(index + 1));
    const next = migrateObservabilityKeys({ ...current, mfaBackupCodes: remaining });
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [stringifyJson(next)]
    );
    result = { matched: true, backupCodesRemaining: remaining.length };
  });
  return result;
}

export async function isCloudEnabled() {
  const settings = await getSettings();
  return settings.cloudEnabled === true;
}

export async function getCloudUrl() {
  const settings = await getSettings();
  return (
    settings.cloudUrl ||
    process.env.CLOUD_URL ||
    process.env.NEXT_PUBLIC_CLOUD_URL ||
    "");

}

export async function exportSettings() {
  return await readRaw();
}
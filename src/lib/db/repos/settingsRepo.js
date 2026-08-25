import { getAdapter, getAdapterSync } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { isBoolean, isString } from "../../../shared/utils/typeChecks.js";

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
  cloudEnabled: false,
  hidePaidModels: false,
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
  providerStrategies: {},
  quotaVisibility: {},
  comboStrategy: "fallback",
  comboStickyRoundRobinLimit: 1,
  comboStrategies: {},
  requireLogin: true,
  tunnelDashboardAccess: true,
  authMode: "password",
  oidcIssuerUrl: "",
  oidcClientId: "",
  oidcClientSecret: "",
  oidcScopes: "openid profile email",
  oidcLoginLabel: "Sign in with OIDC",
  passwordSessionEpoch: "initial",
  enableObservability: true,
  enableProxyTimeline: false,
  proxyTimelineRetentionDays: 1,
  observabilityMaxRecords: 1000,
  observabilityBatchSize: 20,
  observabilityFlushIntervalMs: 5000,
  observabilityMaxJsonSize: 5,
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
  pxpipeEnabled: true,
  pxpipeMinChars: 25000,
  pxpipeTimeoutMs: 15000,
  pxpipeAllowedModels: [],
  providerConcurrencyLimits: {},
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
  cavemanEnabled: false,
  cavemanLevel: "full",
  quotaTrackerState: DEFAULT_QUOTA_TRACKER_STATE,
  ponytailEnabled: false,
  ponytailLevel: "full",
  // Default: free no-auth providers remain enabled unless the user explicitly
  // disables them via Settings > Providers.
  disabledFreeProviders: [],
  // #10372: opt-in only — fresh installs (or rows missing the persisted
  // key) must not run in debug mode; a persisted `true` is preserved.
  debugMode: false
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

// Atomic read-merge-write inside transaction (prevents losing concurrent updates)
export async function updateSettings(updates) {
  const { enableObservability2: _legacyObservability, ...sanitizedUpdates } = updates;
  const db = await getAdapter();
  let next;
  db.transaction(() => {
    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    const current = migrateObservabilityKeys(row ? parseJson(row.data, {}) : {});
    next = migrateObservabilityKeys({ ...current, ...sanitizedUpdates });
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
    next = migrateObservabilityKeys({ ...current, ...sanitizedUpdates });
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [stringifyJson(next)]
    );
  });
  if (!matched) throw new PasswordEpochMismatchError();
  return mergeWithDefaults(next);
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
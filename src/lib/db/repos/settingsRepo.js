import { FREE_NO_AUTH_PROVIDER_IDS } from "@/shared/constants/freeNoAuthProviders";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const DEFAULT_MITM_ROUTER_BASE = "http://localhost:20128";
const DEFAULT_HEADROOM_URL = process.env.HEADROOM_URL || "http://localhost:8787";

const DEFAULT_QUOTA_TRACKER_STATE = {
  providerFilter: "all",
  accountFilter: "all",
  quotaSortMode: "default",
  expiringFirst: false,
  pageSize: 20,
  page: 1,
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
  enableObservability: true,
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
  // Default: every free no-auth provider is disabled unless explicitly enabled.
  disabledFreeProviders: [...FREE_NO_AUTH_PROVIDER_IDS],
};

async function readRaw() {
  const db = await getAdapter();
  const row = db.get(`SELECT data FROM settings WHERE id = 1`);
  return row ? parseJson(row.data, {}) : {};
}

// Merge raw settings with defaults; backward-compat for missing keys
function mergeWithDefaults(raw) {
  const merged = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  merged.quotaTrackerState = {
    ...DEFAULT_QUOTA_TRACKER_STATE,
    ...((raw || {}).quotaTrackerState || {}),
  };
  for (const [key, defVal] of Object.entries(DEFAULT_SETTINGS)) {
    if (merged[key] !== undefined) continue;
    if (
      key === "outboundProxyEnabled" &&
      typeof merged.outboundProxyUrl === "string" &&
      merged.outboundProxyUrl.trim()
    ) {
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
  const db = await getAdapter();
  let next;
  db.transaction(() => {
    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    const current = row ? parseJson(row.data, {}) : {};
    next = { ...current, ...updates };
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [stringifyJson(next)]
    );
  });
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
    ""
  );
}

export async function exportSettings() {
  return await readRaw();
}

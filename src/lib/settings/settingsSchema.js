import { isBoolean, isNumber, isRecord, isString } from "@/shared/utils/typeChecks.js";

const DEFAULT_MITM_ROUTER_BASE = "http://localhost:20128";
const DEFAULT_HEADROOM_URL = process.env.HEADROOM_URL || "http://localhost:8787";

export const DEFAULT_QUOTA_TRACKER_STATE = {
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
  // Settings used by routing, CLI integrations and the MITM manager.
  ccFilterNaming: false,
  enableTranslator: false,
  providerThinking: {},
  fallbackStrategy: "fill-first",
  quotaSelection: {},
  cloudUrl: "",
  cliproxyapi_url: "",
  mitmEnabled: false,
  mitmCertInstalled: false,
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
  // Controls logging of tool source summaries.
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
  proxyTestUrl: "",
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


const secretKeys = ["password", "passwordSessionEpoch", "mitmSudoEncrypted", "postgresUrl", "mfaEnabled", "mfaSecret", "mfaBackupCodes", "operatorWebhooks", "openrouterRouting"];
const authCriticalKeys = ["comboPrompts", "exposeComboOnly", "requireLogin", "requireApiKey", "authMode", "oidcIssuerUrl", "oidcClientId", "oidcClientSecret", "oidcScopes", "oidcLoginLabel", "oidcAllowedSubjects", "oidcAllowedEmails", "oidcAllowedDomains", "tunnelDashboardAccess", "enableObservability", "logToolSources", "enableSessionCapture", "outboundProxyEnabled", "outboundProxyUrl", "outboundNoProxy", "headroomEnabled", "headroomUrl", "headroomCompressUserMessages", "mitmRouterBaseUrl", "claudeClassifierCompat", "lanDiscoveryEnabled"];
const redactKeys = ["password", "passwordSessionEpoch", "oidcClientSecret", "mitmSudoEncrypted", "postgresUrl", "mfaSecret", "mfaBackupCodes", "operatorWebhooks", "openrouterRouting"];
const scopedKeys = ["claudeAutoPing", "codexAutoPing"];

const typeForDefault = (value) => {
  if (value === null) return "nullable";
  if (Array.isArray(value)) return "array";
  if (isRecord(value)) return "object";
  if (isBoolean(value)) return "boolean";
  if (isNumber(value)) return "number";
  if (isString(value)) return "string";
  return "unknown";
};

const specialTypes = {
  retryDelayByProvider: "object", rpmByProvider: "object", providerErrorRules: "object",
  comboStrategies: "object", comboPrompts: "object", compressionEngines: "object",
  modelFallbacks: "object", mediaRoutes: "object",
  requireApiKey: "boolean", password: "string", mitmSudoEncrypted: "string",
  postgresUrl: "string", operatorWebhooks: "array", openrouterRouting: "object",
  quotaProviderOrder: "array", antigravityAdaptiveHealth: "object", claudeAutoPing: "object", codexAutoPing: "object",
  theme: "string",
  pxpipeAutoInstall: "unknown",
};
const mergeByKey = new Set(["comboStrategies", "providerErrorRules", "retryDelayByProvider", "compressionEngines"]);

export const SETTINGS_SCHEMA = Object.fromEntries([
  ...Object.entries(DEFAULT_SETTINGS).map(([key, value]) => [key, Object.freeze({
    type: specialTypes[key] || typeForDefault(value), default: value,
    secret: secretKeys.includes(key), authCritical: authCriticalKeys.includes(key),
    scoped: scopedKeys.includes(key), redactOnGet: redactKeys.includes(key),
    merge: mergeByKey.has(key) ? "keys" : null,
  })]),
  ...["password", "mitmSudoEncrypted", "postgresUrl", "operatorWebhooks", "openrouterRouting", "quotaProviderOrder", "antigravityAdaptiveHealth", "requireApiKey", "claudeAutoPing", "codexAutoPing", "modelFallbacks", "mediaRoutes", "theme", "pxpipeAutoInstall"].filter((key) => !Object.hasOwn(DEFAULT_SETTINGS, key)).map((key) => [key, Object.freeze({
    type: specialTypes[key], default: undefined, secret: secretKeys.includes(key), authCritical: authCriticalKeys.includes(key), scoped: scopedKeys.includes(key), redactOnGet: redactKeys.includes(key), merge: null
  })]),
  ...["newPassword", "currentPassword", "mfaCode"].map((key) => [key, Object.freeze({
    type: "string", default: undefined, secret: false, authCritical: false, scoped: false, redactOnGet: false, merge: null
  })]),
]);

export const DEFAULT_SETTINGS_SCHEMA = DEFAULT_SETTINGS;
export const SECRET_SETTING_KEYS = Object.freeze(Object.keys(SETTINGS_SCHEMA).filter((key) => SETTINGS_SCHEMA[key].secret));
export const AUTH_CRITICAL_SETTING_KEYS = Object.freeze(Object.keys(SETTINGS_SCHEMA).filter((key) => SETTINGS_SCHEMA[key].authCritical));
export const SCOPED_SETTING_KEYS = Object.freeze(Object.keys(SETTINGS_SCHEMA).filter((key) => SETTINGS_SCHEMA[key].scoped));
export const REDACT_ON_GET_SETTING_KEYS = Object.freeze(Object.keys(SETTINGS_SCHEMA).filter((key) => SETTINGS_SCHEMA[key].redactOnGet));

const constraints = {
  claudeClassifierCompat: { enum: ["off", "auto", "always"] },
  databaseEngine: { enum: ["sqlite", "postgres"] },
  databasePgVersion: { enum: [16, 17, 18], integer: true },
  proxyTimelineRetentionDays: { enum: [1, 3, 7] },
  stickyRoundRobinLimit: { minimum: 1, integer: true },
  pxpipeMinChars: { minimum: 1, integer: true },
  pxpipeTimeoutMs: { minimum: 1000, maximum: 120000, integer: true },
  headroomTimeoutMs: { minimum: 1000, maximum: 120000, integer: true },
  dataRetentionDays: { minimum: 1, maximum: 3650, integer: true },
  globalConcurrentRequests: { minimum: 0, integer: true },
};
const routeValidatedKeys = new Set([
  "enableSessionCapture", "oidcAllowedSubjects", "oidcAllowedEmails", "oidcAllowedDomains",
  "newPassword", "oidcClientSecret", "firecrawlBaseUrl", "pxpipeMinChars", "pxpipeTimeoutMs", "headroomTimeoutMs",
  "pxpipeEnabled", "pxpipeAllowedModels", "modelVisibilityAllowlist", "modelVisibilityDenylist",
  "retryDelayByProvider", "disabledFreeProviders", "rpmByProvider", "providerErrorRules",
  "egressBucketedProviders", "comboStrategies", "comboPrompts", "mediaRoutes", "compressionEngines",
  "enableProxyTimeline", "proxyTimelineRetentionDays", "dataRetentionEnabled", "lanDiscoveryEnabled",
  "claudeClassifierCompat", "dataRetentionDays", "customPromptEnabled", "customPrompt",
  "outboundProxyEnabled", "outboundProxyUrl", "outboundNoProxy",
  "comboStrategy", "comboStickyRoundRobinLimit", "modelFallbacks",
]);
for (const [key, constraint] of Object.entries(constraints)) {
  SETTINGS_SCHEMA[key] = Object.freeze({ ...SETTINGS_SCHEMA[key], ...constraint });
}

export function validateSettingsPatch(patch) {
  const invalid = [];
  for (const [key, value] of Object.entries(patch)) {
    const rule = SETTINGS_SCHEMA[key];
    if (!rule) { invalid.push(key); continue; }
    if (routeValidatedKeys.has(key)) continue;
    if (value === null) {
      if (rule.type === "nullable") continue;
      invalid.push(key);
      continue;
    }
    const typeIsValid = rule.type === "nullable"
      ? isString(value) || isNumber(value)
      : rule.type === "boolean" ? isBoolean(value)
        : rule.type === "number" ? isNumber(value)
          : rule.type === "string" ? isString(value)
            : rule.type === "array" ? Array.isArray(value)
              : rule.type === "object" ? isRecord(value)
                : true;
    if (!typeIsValid) { invalid.push(key); continue; }
    if (rule.enum && !rule.enum.includes(value) || isNumber(value) && (rule.integer && !Number.isSafeInteger(value) || rule.minimum !== undefined && value < rule.minimum || rule.maximum !== undefined && value > rule.maximum)) invalid.push(key);
  }
  return invalid;
}

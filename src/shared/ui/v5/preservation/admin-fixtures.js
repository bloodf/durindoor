import { CLI_TOOLS } from "../../../constants/cliTools.js";
import { MEDIA_PROVIDER_KINDS } from "../../../constants/providers.js";

export const ADMIN_PASSWORD = "review-password-only";
export const ADMIN_MFA_SECRET = "JBSWY3DPEHPK3PXP";
export const ADMIN_BACKUP_CODES = ["review-backup-0001", "review-backup-0002"];
export const ADMIN_CLI_IDS = Object.freeze(Object.keys(CLI_TOOLS));
export const ADMIN_MEDIA_KINDS = Object.freeze(MEDIA_PROVIDER_KINDS.map(({ id }) => id));
const clone = (value) => structuredClone(value);

/** Per-story in-memory contracts. No host/client configuration or authentication occurs. */
export function createAdminFixture(options = {}) {
  let state;
  const calls = [];
  const reset = () => {
    calls.length = 0;
    state = {
      settings: {
        fallbackStrategy: "fill-first", comboStrategy: "fallback", requireLogin: true,
        hasPassword: true, authMode: "both", oidcIssuerUrl: "https://issuer.example.test",
        oidcClientId: "review-client", oidcScopes: "openid profile email",
        oidcLoginLabel: "Review SSO", oidcConfigured: true, hasOidcClientSecret: true,
        mfaEnabled: false, mfaBackupCodesRemaining: 0, cloudEnabled: false,
        enableObservability: true, enableProxyTimeline: true, proxyTimelineRetentionDays: 7,
        dataRetentionEnabled: true, dataRetentionDays: 30, modelAutoSyncIntervalHours: 24,
        ...options.settings,
      },
      engine: {
        activeEngine: options.engine || "sqlite", databaseEngine: options.engine || "sqlite",
        databasePgVersion: 18, databasePgFeatures: {}, effectiveCapabilities: {},
        snapshots: options.engine === "postgres" ? [{ id: "review-snapshot" }] : [],
      },
      providers: [{ id: "review-openai", provider: "openai", name: "Review OpenAI", authType: "apikey", isActive: true, testStatus: "active", priority: 1, providerSpecificData: {} }],
      instances: [
        { id: "review-http", slug: "review-http", title: "Review HTTP", kind: "http", transport: "http", url: "https://mcp.example.test/mcp", headers: {}, enabled: true, oauth: true, oauthStatus: "connected" },
        { id: "review-stdio", slug: "review-stdio", title: "Review stdio", kind: "command", transport: "stdio", command: "review-command", args: ["--offline"], env: { REVIEW_ONLY: "true" }, enabled: true },
      ],
      keys: [{ id: "review-mcp-key", name: "Review harness", machineId: "review-machine", createdAt: "2026-10-08T00:00:00Z" }],
      grants: ["review-http"],
      mitm: { running: options.mitmRunning ?? true, certExists: true, certTrusted: true, dnsStatus: { antigravity: true, kiro: false }, hasCachedPassword: true, needsSudoPassword: false, isWin: false, isAdmin: false, mitmRouterBaseUrl: "http://localhost:20128", ...options.mitm },
      aliases: {}, cli: {}, imports: [], retentionRuns: 0, nodes: [],
    };
    if (options.engineError) Object.assign(state.engine, { databaseEngine: "postgres", servingFallback: true, databaseEngineError: "Review cluster unavailable" });
  };
  reset();
  const body = (value, status = 200) => ({ body: clone(value), status });
  const endpoint = (method, path, handler) => async (request) => {
    const payload = method === "GET" ? null : await request.json().catch(() => ({}));
    calls.push({ method, path, payload, password: request.headers.get("x-9r-password") });
    return handler(payload, request);
  };
  const routes = {};
  const add = (method, path, handler) => { routes[`${method} ${path}`] = endpoint(method, path, handler); };
  add("GET", "/api/settings", () => body(state.settings));
  add("PATCH", "/api/settings", (patch) => {
    if (options.settingsError) return body({ error: "Review settings rejected" }, 503);
    state.settings = { ...state.settings, ...patch };
    return body(state.settings);
  });
  add("GET", "/api/providers", () => body({ connections: state.providers }));
  add("GET", "/api/provider-nodes", () => body({ nodes: state.nodes }));
  add("POST", "/api/provider-nodes", (payload) => {
    const node = { ...payload, id: `review-custom-${state.nodes.length}` };
    state.nodes.push(node);
    return body({ node });
  });
  add("POST", "/api/provider-nodes/validate", () => body({ valid: true, models: [{ id: "review-model", name: "Review model" }] }));
  add("GET", "/api/models/custom", () => body({ models: [] }));
  add("GET", "/api/models/alias/all", () => body({ aliases: {} }));
  add("GET", "/api/v1/models/embedding", () => body({ data: [] }));
  add("GET", "/api/models/alias", () => body({ aliases: state.aliases }));
  add("GET", "/api/tunnel/status", () => body({ tunnel: { enabled: false, publicUrl: "" }, tailscale: { enabled: false, tunnelUrl: "" } }));
  add("GET", "/api/keys", () => body({ keys: [{ id: "review-client-key", name: "Review client", maskedKey: "sk_review_••••" }], providerConnections: state.providers }));
  add("GET", "/api/keys/review-client-key/reveal", () => body({ key: "sk_review_NOT_A_REAL_KEY" }));
  add("GET", "/api/combos", () => body({ combos: [] }));
  add("GET", "/api/proxy-pools", () => body({ proxyPools: [] }));
  add("GET", "/api/data-retention", () => body({ lastRun: null }));
  add("POST", "/api/data-retention", () => {
    state.retentionRuns += 1;
    return options.retentionError ? body({ error: "Review cleanup rejected" }, 503) : body({ ranAt: "2026-10-08T10:00:00Z", days: state.settings.dataRetentionDays, deleted: { usage: 3, requests: 2 } });
  });
  add("POST", "/api/auth/oidc/test", () => options.oidcError ? body({ error: "Review issuer discovery failed" }, 503) : body({ ok: true, issuerUrl: state.settings.oidcIssuerUrl }));
  add("GET", "/api/settings/database", (_, request) => request.headers.get("x-9r-password") === ADMIN_PASSWORD ? body({ version: 1, settings: state.settings, providerConnections: [], combos: [] }) : body({ error: "Review password rejected" }, 401));
  add("POST", "/api/settings/database", (payload) => {
    if (payload.password !== ADMIN_PASSWORD) return body({ error: "Review password rejected" }, 401);
    state.imports.push(payload);
    return body({ ok: true });
  });
  add("POST", "/api/settings/database/selective", (payload) => {
    if (payload.password !== ADMIN_PASSWORD) return body({ error: "Review password rejected" }, 401);
    if (payload.action === "catalog") return body({ providers: state.providers, combos: [{ id: "review-combo", name: "Review combo" }] });
    if (payload.action === "preview") return body({ providerConnections: (payload.selection?.providers || []).map((id) => ({ id, currentName: "Review OpenAI", action: "update" })), combos: (payload.selection?.combos || []).map((id) => ({ id, finalName: "Review combo", action: "update" })) });
    if (payload.action === "apply") state.imports.push(payload);
    return body({ providerConnections: [], combos: [], ok: true });
  });
  const authorizedEngine = (handler) => (payload, request) => request.headers.get("x-9r-password") !== ADMIN_PASSWORD ? body({ error: "Review password rejected" }, 401) : handler(payload);
  add("GET", "/api/settings/database/engine", authorizedEngine(() => body(state.engine)));
  add("POST", "/api/settings/database/test", authorizedEngine((payload) => {
    if (options.databaseError) return body({ ok: false, error: "Review cluster unavailable" }, 503);
    state.testedUrl = payload.url;
    return body({ ok: true, latencyMs: 8, serverVersion: "18.0" });
  }));
  add("POST", "/api/settings/database/cutover", authorizedEngine(() => {
    if (options.databaseError) return body({ ok: false, error: "Review cutover rejected" }, 503);
    state.engine = { ...state.engine, activeEngine: "postgres", databaseEngine: "postgres", snapshots: [{ id: "review-snapshot" }], databaseCutoverAt: "2026-10-08T00:00:00Z", databaseCutoverSchemaVersion: 1 };
    return body({ ok: true });
  }));
  add("POST", "/api/settings/database/rollback", authorizedEngine((payload) => {
    if (!payload.force || !state.engine.snapshots.length) return body({ error: "Review snapshot required" }, 400);
    state.engine.activeEngine = "sqlite";
    state.engine.databaseEngine = "sqlite";
    return body({ ok: true });
  }));
  add("GET", "/api/auth/status", () => body({ authenticated: false, requireLogin: true, hasPassword: true, authMode: "password", oidcConfigured: false, ...options.auth }));
  add("POST", "/api/auth/login", () => {
    if (options.login === "success") return body({ success: true });
    if (options.login === "mfa") return body({ mfaRequired: true });
    if (options.login === "change") return body({ mustChangePassword: true, requiresPasswordChange: true, proof: "review-proof" }, 403);
    if (options.login === "remote") return body({ mustChangePassword: true }, 403);
    if (options.login === "locked") return body({ error: "Review sign-in locked", retryAfter: 2 }, 429);
    return body({ error: "Review password rejected", resetHint: "Review host reset instruction" }, 401);
  });
  add("POST", "/api/auth/mfa/verify", () => {
    if (options.mfaSuccess) return body({ success: true });
    const rejection = { error: "Review code rejected" };
    if (options.mfaLocked) rejection.retryAfter = 2;
    return body(rejection, options.mfaLocked ? 429 : 401);
  });
  add("POST", "/api/auth/change-password", () => body({ error: "Review password change rejected" }, 400));
  add("POST", "/api/auth/mfa/setup", (payload) => payload.password === ADMIN_PASSWORD ? body({ secret: ADMIN_MFA_SECRET, qrCodeDataUri: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Ctext x='10' y='50'%3EREVIEW%3C/text%3E%3C/svg%3E" }) : body({ error: "Review password rejected" }, 401));
  add("POST", "/api/auth/mfa/enable", (payload) => {
    if (payload.password !== ADMIN_PASSWORD || payload.secret !== ADMIN_MFA_SECRET || payload.code !== "123456") return body({ error: "Review code rejected" }, 400);
    state.settings.mfaEnabled = true;
    state.settings.mfaBackupCodesRemaining = ADMIN_BACKUP_CODES.length;
    return body({ backupCodes: ADMIN_BACKUP_CODES });
  });
  add("POST", "/api/auth/mfa/disable", (payload) => {
    if (payload.password !== ADMIN_PASSWORD || !["123456", ADMIN_BACKUP_CODES[0]].includes(payload.code)) return body({ error: "Review code rejected" }, 400);
    state.settings.mfaEnabled = false;
    state.settings.mfaBackupCodesRemaining = 0;
    return body({ ok: true });
  });
  add("GET", "/api/mcp-gateway/instances", () => options.instancesError ? body({ error: "Review instance catalog unavailable" }, 503) : body({ instances: state.instances }));
  add("POST", "/api/mcp-gateway/instances", (payload) => {
    const instance = { ...payload, id: `review-created-${state.instances.length}` };
    state.instances.push(instance);
    return body({ instance });
  });
  for (const id of ["review-http", "review-stdio"]) {
    add("PUT", `/api/mcp-gateway/instances/${id}`, (payload) => { Object.assign(state.instances.find((item) => item.id === id), payload); return body({ ok: true }); });
    add("POST", `/api/mcp-gateway/instances/${id}/test`, () => body({ ok: true, toolCount: 2, sample: [{ name: "review_read" }, { name: "review_search" }] }));
  }
  add("GET", "/api/mcp-gateway/keys", () => body({ keys: state.keys }));
  add("GET", "/api/mcp-gateway/keys/review-mcp-key", () => options.grantsError ? body({ error: "Review grants unavailable" }, 503) : body({ grants: state.grants }));
  add("PUT", "/api/mcp-gateway/keys/review-mcp-key", (payload) => { state.grants = [...payload.grants]; return body({ ok: true }); });
  add("GET", "/api/cli-tools/antigravity-mitm", () => body(state.mitm));
  add("GET", "/api/cli-tools/antigravity-mitm/alias", (_, request) => body({ aliases: state.aliases[new URL(request.url).searchParams.get("tool")] || {} }));
  add("PUT", "/api/cli-tools/antigravity-mitm/alias", (payload) => { state.aliases[payload.tool] = payload.mappings; return body({ ok: true }); });
  add("POST", "/api/cli-tools/antigravity-mitm", (payload) => {
    if (options.portConflict && !payload.forceKillPort443) return body({ code: "PORT_443_BUSY", error: "Review port busy", portOwner: { pid: 1234, name: "review-owner", command: "review-process" } }, 409);
    state.mitm.running = true;
    return body(state.mitm);
  });
  add("DELETE", "/api/cli-tools/antigravity-mitm", () => { state.mitm.running = false; return body(state.mitm); });
  add("PATCH", "/api/cli-tools/antigravity-mitm", (payload) => {
    if (payload.action === "trust-cert") state.mitm.certTrusted = true;
    else state.mitm.dnsStatus[payload.tool] = payload.action === "enable";
    return body(state.mitm);
  });
  for (const toolId of ADMIN_CLI_IDS) {
    const path = `/api/cli-tools/${toolId}-settings`;
    const initial = () => ({ installed: true, hasBackup: true, has9Router: true, settings: { env: {} }, config: toolId === "codex" ? 'model = "openai/gpt-4.1"\n[agents.subagent]\nmodel = "openai/gpt-4.1"' : { model: "openai/gpt-4.1", providers: {}, env: {} }, agents: [], openclaw: {}, opencode: { models: ["openai/gpt-4.1"] } });
    add("GET", path, () => body(state.cli[toolId] || initial()));
    add("POST", path, (payload) => { state.cli[toolId] = { ...initial(), ...payload, has9Router: true }; return body({ success: true, message: "Review settings applied" }); });
    add("DELETE", path, () => { state.cli[toolId] = { ...initial(), has9Router: false, hasBackup: false }; return body({ success: true, message: "Review settings restored" }); });
  }
  add("GET", "/api/cli-tools/all-statuses", () => body(Object.fromEntries(ADMIN_CLI_IDS.map((id) => [id, { installed: true, configured: true, has9Router: true }]))));
  return { routes, calls, reset, snapshot: () => clone(state) };
}

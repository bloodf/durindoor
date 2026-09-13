// /api/settings, /api/settings/auto-configure, /api/settings/proxy-test,
// /api/settings/require-login, /api/data-retention, /api/users, /api/payments.
import { badRequest, reply, wait } from "../../http.js";
import { DATA_RETENTION_PRESETS, DEMO_USERS, seedRetentionRun, seedSettings } from "../../fixtures/configSettings.js";
import { buildAutoConfigureReport, buildAutoConfigureStatus } from "../../fixtures/autoConfigure.js";

export const SETTINGS = "config.settings";
const RETENTION_RUN = "config.retentionLastRun";
const SECRET_KEYS = ["password", "passwordSessionEpoch", "oidcClientSecret", "mitmSudoEncrypted"];

export function readSettings(store) {
  return { ...seedSettings(), ...(store.get(SETTINGS) || {}) };
}

export function writeSettings(store, patch) {
  return store.set(SETTINGS, { ...readSettings(store), ...patch });
}

function publicSettings(settings) {
  const safe = Object.fromEntries(Object.entries(settings).filter(([key]) => !SECRET_KEYS.includes(key)));
  return {
    ...safe,
    oidcConfigured: Boolean(settings.oidcIssuerUrl && settings.oidcClientId && settings.oidcClientSecret),
    enableTranslator: true,
    hasPassword: true,
  };
}

// Returns an error reply for invalid fields, or null when the patch is fine.
function validatePatch(body) {
  const has = (key) => Object.hasOwn(body, key);
  if (has("dataRetentionDays") && !(Number.isInteger(body.dataRetentionDays) && body.dataRetentionDays >= 1 && body.dataRetentionDays <= 3650)) {
    return badRequest("Invalid dataRetentionDays");
  }
  if (has("proxyTimelineRetentionDays") && ![1, 3, 7].includes(body.proxyTimelineRetentionDays)) {
    return badRequest("Invalid proxyTimelineRetentionDays");
  }
  if (has("firecrawlBaseUrl") && String(body.firecrawlBaseUrl || "").trim()) {
    try {
      new URL(String(body.firecrawlBaseUrl).trim());
    } catch {
      return badRequest("Invalid firecrawlBaseUrl");
    }
  }
  if (has("pxpipeTimeoutMs") && !(Number.isSafeInteger(body.pxpipeTimeoutMs) && body.pxpipeTimeoutMs >= 1000 && body.pxpipeTimeoutMs <= 120000)) {
    return badRequest("Invalid pxpipeTimeoutMs");
  }
  if (has("newPassword")) {
    if (!body.newPassword) return badRequest("Password must not be empty");
    if (String(body.newPassword).length < 8) return badRequest("Password must be at least 8 characters");
    if (!body.currentPassword) return badRequest("Current password required");
  }
  return null;
}

function patchSettings({ body, store }) {
  const input = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const invalid = validatePatch(input);
  if (invalid) return invalid;
  const { currentPassword, newPassword, oidcClientSecret, ...patch } = input;
  const extra = oidcClientSecret && String(oidcClientSecret).trim() ? { oidcClientSecret } : {};
  return publicSettings(writeSettings(store, { ...patch, ...extra }));
}

function retentionResult(days) {
  const now = Date.now();
  // Most of the backlog was already pruned by the scheduled run; a manual run
  // only finds the handful of rows that aged out since.
  const scale = Math.max(1, Math.round(90 / days));
  return {
    ranAt: new Date(now).toISOString(),
    trigger: "manual",
    days,
    cutoff: new Date(now - days * 86_400_000).toISOString(),
    deleted: { usage: 14 * scale, requestDetails: 6 * scale, timeline: 21 * scale, quotaSnapshots: scale },
  };
}

export default function register(router, { store }) {
  store.define(SETTINGS, seedSettings);
  store.define(RETENTION_RUN, seedRetentionRun);

  router.get("/api/settings", () => publicSettings(readSettings(store)));
  router.patch("/api/settings", ({ body }) => patchSettings({ body, store }));
  router.put("/api/settings", ({ body }) => patchSettings({ body, store }));

  router.get("/api/settings/require-login", () => {
    const settings = readSettings(store);
    return {
      requireLogin: settings.requireLogin !== false,
      tunnelDashboardAccess: settings.tunnelDashboardAccess !== false,
      tunnelUrl: settings.tunnelUrl || "",
      tailscaleUrl: settings.tailscaleUrl || "",
    };
  });

  router.post("/api/settings/proxy-test", async ({ body }) => {
    const proxyUrl = String(body?.proxyUrl || "").trim();
    if (!proxyUrl) return reply({ ok: false, error: "Proxy URL is required" }, { status: 400 });
    try {
      new URL(proxyUrl);
    } catch {
      return reply({ ok: false, error: `Invalid proxy URL: ${proxyUrl}` }, { status: 400 });
    }
    await wait(400);
    return { ok: true, status: 200, statusText: "OK", elapsedMs: 312 };
  });

  router.get("/api/settings/auto-configure", () => ({ ok: true, ...buildAutoConfigureStatus(readSettings(store)) }));
  router.post("/api/settings/auto-configure", async ({ body }) => {
    const dryRun = body?.dryRun === true;
    await wait(dryRun ? 300 : 900);
    const { updates, ...report } = buildAutoConfigureReport(readSettings(store), { dryRun });
    if (!dryRun && report.changed) writeSettings(store, updates);
    return { ok: true, dryRun, changed: report.changed, report: { ...report, updates } };
  });

  router.get("/api/data-retention", () => {
    const settings = readSettings(store);
    return {
      enabled: settings.dataRetentionEnabled === true,
      days: settings.dataRetentionDays || 30,
      presets: DATA_RETENTION_PRESETS,
      lastRun: store.get(RETENTION_RUN),
    };
  });
  router.post("/api/data-retention", async ({ body }) => {
    const days = Number(body?.days ?? readSettings(store).dataRetentionDays);
    if (!Number.isInteger(days) || days < 1 || days > 3650) return badRequest("Invalid days");
    await wait(600);
    return store.set(RETENTION_RUN, retentionResult(days));
  });

  router.get("/api/users", () => ({ users: DEMO_USERS }));
  router.get("/api/payments", () => ({ payments: [], plan: "self-hosted" }));
}

import { NextResponse } from "next/server";
import { FREE_NO_AUTH_PROVIDER_IDS } from "@/shared/constants/freeNoAuthProviders";
import { MAX_RATE_LIMIT_COOLDOWN_MS } from "open-sse/config/errorConfig.js";
import { MAX_PROVIDER_RPM } from "@/shared/constants/providers";
import { getSettings, updateSettings, updateSettingsWithPasswordEpoch, PasswordEpochMismatchError } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { resetComboRotation, resetComboScoring } from "open-sse/services/combo.js";
import { setOperatorProviderErrorRules } from "open-sse/config/providerErrorRules.js";
import { DEFAULT_PASSWORD, invalidateDefaultPasswordCache, setDashboardAuthCookie, validateDashboardPassword, verifyDashboardPassword } from "@/lib/auth/dashboardSession";
import { resetPasswordChangeProofs } from "@/lib/auth/passwordChangeProof";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import crypto from "node:crypto";
import {
  AUTH_CRITICAL_SETTING_KEYS,
  SECRET_SETTING_KEYS,
  canModifySecurityCriticalSettings,
  stripSettingKeys,
} from "@/lib/settings/settingsPatchAuth";
import { isBoolean, isNumber, isObject, isString } from "@/shared/utils/typeChecks.js";
import { normalizeMediaRoutes } from "@/shared/constants/mediaRoutes.js";
import { redactProxyUrlCredentials } from "@/shared/utils/proxyUrlRedaction.js";
import { isOperatorRequest } from "@/dashboardGuard";
import { resolveObservabilityEnabled } from "@/lib/db/repos/requestDetailsRepo";
import { validateModelAutoSyncSettingsPatch } from "@/lib/modelAutoSync/catalog.js";

const SETTINGS_RESPONSE_HEADERS = {
  "Cache-Control": "no-store"
};

const SCOPED_SETTING_KEYS = ["claudeAutoPing", "codexAutoPing"];

/**
 * Shape settings for a response.
 *
 * `password`, `passwordSessionEpoch`, `oidcClientSecret`, `mitmSudoEncrypted`
 * and `postgresUrl` are withheld from every caller — the PG connection string
 * carries `user:password@` for the database itself, so it never leaves the
 * server even for an operator. `outboundProxyUrl` may embed
 * `user:password@`, so its userinfo is redacted unless the caller proved
 * dashboard or CLI identity: an application API key is an inference
 * credential, not an operator session, and must not read proxy credentials.
 *
 * @param {object} settings
 * @param {{ privileged: boolean }} options
 */
function sanitizeSettingsForResponse(settings, { privileged }) {
  const {
    password,
    passwordSessionEpoch,
    oidcClientSecret,
    mitmSudoEncrypted,
    postgresUrl,
    mfaSecret,
    mfaBackupCodes,
    ...safeSettings
  } = settings;
  void postgresUrl;
  void mfaSecret;
  safeSettings.oidcConfigured = !!(safeSettings.oidcIssuerUrl && safeSettings.oidcClientId && oidcClientSecret);
  // mfaEnabled is a plain flag (safe to expose); the secret and recovery-code
  // hashes never leave the server. Only a count is exposed so the profile UI
  // can warn when backup codes are running low.
  safeSettings.mfaEnabled = settings.mfaEnabled === true;
  safeSettings.mfaBackupCodesRemaining = Array.isArray(mfaBackupCodes) ? mfaBackupCodes.length : 0;
  if (!privileged && safeSettings.outboundProxyUrl) {
    safeSettings.outboundProxyUrl = redactProxyUrlCredentials(safeSettings.outboundProxyUrl);
  }
  return { safeSettings, password };
}

export async function GET(request) {
  try {
    const settings = await getSettings();
    const privileged = await isOperatorRequest(request);
    const { safeSettings, password } = sanitizeSettingsForResponse(settings, { privileged });

    const enableObservability = resolveObservabilityEnabled(settings);
    const enableTranslator = process.env.ENABLE_TRANSLATOR === "true";

    return NextResponse.json({
      ...safeSettings,
      enableObservability,
      enableTranslator,
      hasPassword: !!password
    }, { headers: SETTINGS_RESPONSE_HEADERS });
  } catch {
    console.error("[settings] read failed");
    return NextResponse.json({ error: "Failed to get settings" }, { status: 500, headers: SETTINGS_RESPONSE_HEADERS });
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();

    if (SCOPED_SETTING_KEYS.some((key) => Object.prototype.hasOwnProperty.call(body, key))) {
      return NextResponse.json({
        error: "Auto-ping must be updated through the connection-scoped endpoint"
      }, { status: 400, headers: SETTINGS_RESPONSE_HEADERS });
    }

    // CWE-915: never mass-assign secrets; auth-critical keys need JWT/CLI proof.
    stripSettingKeys(body, SECRET_SETTING_KEYS);
    const mayModifySecurityCritical = await canModifySecurityCriticalSettings(request);
    if (!mayModifySecurityCritical) {
      stripSettingKeys(body, AUTH_CRITICAL_SETTING_KEYS);
    }

    let passwordSessionEpoch;
    let expectedPasswordSessionEpoch = "initial";
    if (Object.prototype.hasOwnProperty.call(body, "newPassword")) {
      if (!body.newPassword) {
        return NextResponse.json({ error: "Password must not be empty" }, { status: 400, headers: SETTINGS_RESPONSE_HEADERS });
      }
      const settings = await getSettings();
      expectedPasswordSessionEpoch = settings.passwordSessionEpoch ?? "initial";
      const initialPassword = process.env.INITIAL_PASSWORD || DEFAULT_PASSWORD;
      const rejection = validateDashboardPassword(body.newPassword);
      if (rejection || body.newPassword === initialPassword) {
        return NextResponse.json({ error: rejection || "Password must not match the configured initial password" }, { status: 400, headers: SETTINGS_RESPONSE_HEADERS });
      }
      if (!body.currentPassword) {
        return NextResponse.json({ error: "Current password required" }, { status: 400, headers: SETTINGS_RESPONSE_HEADERS });
      }
      if (!(await verifyDashboardPassword(body.currentPassword))) {
        return NextResponse.json({ error: "Invalid current password" }, { status: 401, headers: SETTINGS_RESPONSE_HEADERS });
      }

      const salt = await bcrypt.genSalt(10);
      passwordSessionEpoch = crypto.randomBytes(16).toString("hex");
      body.password = await bcrypt.hash(body.newPassword, salt);
      body.passwordSessionEpoch = passwordSessionEpoch;
    }


    delete body.currentPassword;
    delete body.newPassword;



    if (Object.prototype.hasOwnProperty.call(body, "oidcClientSecret")) {
      if (!body.oidcClientSecret || !String(body.oidcClientSecret).trim()) {
        delete body.oidcClientSecret;
      }
    }

    // Validate firecrawlBaseUrl if present
    if (Object.prototype.hasOwnProperty.call(body, "firecrawlBaseUrl")) {
      const raw = String(body.firecrawlBaseUrl || "").trim();
      if (raw) {
        try {
          new URL(raw);
        } catch {
          return NextResponse.json({ error: "Invalid firecrawlBaseUrl" }, { status: 400, headers: SETTINGS_RESPONSE_HEADERS });
        }
      }
      body.firecrawlBaseUrl = raw;
    }

    /**
     * Validate PXPIPE settings. Bounds rationale: minChars must be a
     * positive integer; timeout floor 1s (below it a transform can never
     * round-trip), ceiling 120s (2x the largest shipped default so a stuck
     * pipeline cannot hold a request open indefinitely); booleans for flags.
     */
    if (Object.prototype.hasOwnProperty.call(body, "pxpipeMinChars")) {
      const v = body.pxpipeMinChars;
      if (!Number.isSafeInteger(v) || v <= 0) {
        return NextResponse.json({ error: "Invalid pxpipeMinChars" }, { status: 400, headers: SETTINGS_RESPONSE_HEADERS });
      }
    }
    if (Object.prototype.hasOwnProperty.call(body, "pxpipeTimeoutMs")) {
      const v = body.pxpipeTimeoutMs;
      if (!Number.isSafeInteger(v) || v < 1000 || v > 120000) {
        return NextResponse.json({ error: "Invalid pxpipeTimeoutMs" }, { status: 400, headers: SETTINGS_RESPONSE_HEADERS });
      }
    }
    /** Headroom uses the same 1–120 second request-timeout bounds as PXPIPE. */
    if (Object.prototype.hasOwnProperty.call(body, "headroomTimeoutMs")) {
      const v = body.headroomTimeoutMs;
      if (!Number.isSafeInteger(v) || v < 1000 || v > 120000) {
        return NextResponse.json({ error: "Invalid headroomTimeoutMs" }, { status: 400, headers: SETTINGS_RESPONSE_HEADERS });
      }
    }
    if (Object.prototype.hasOwnProperty.call(body, "pxpipeEnabled") && !isBoolean(body.pxpipeEnabled)) {
      return NextResponse.json({ error: "Invalid pxpipeEnabled" }, { status: 400, headers: SETTINGS_RESPONSE_HEADERS });
    }
    if (Object.prototype.hasOwnProperty.call(body, "pxpipeAllowedModels")) {
      const raw = body.pxpipeAllowedModels;
      if (!Array.isArray(raw) || raw.some((m) => !isString(m))) {
        return NextResponse.json({ error: "Invalid pxpipeAllowedModels" }, { status: 400, headers: SETTINGS_RESPONSE_HEADERS });
      }
      body.pxpipeAllowedModels = Array.from(new Set(raw.map((m) => m.trim()).filter(Boolean)));
    }
    // pxpipeAutoInstall was removed with runtime installs; strip so legacy
    // clients can't persist dead config.
    delete body.pxpipeAutoInstall;

    // OmniRoute #11481 (port(omniroute)): operator glob allow/deny list for
    // /v1/models exposure. Same validation shape as pxpipeAllowedModels above.
    for (const key of ["modelVisibilityAllowlist", "modelVisibilityDenylist"]) {
      if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
      const raw = body[key];
      if (!Array.isArray(raw) || raw.some((m) => !isString(m))) {
        return NextResponse.json({ error: `Invalid ${key}` }, { status: 400, headers: SETTINGS_RESPONSE_HEADERS });
      }
      body[key] = Array.from(new Set(raw.map((m) => m.trim()).filter(Boolean)));
    }

    /** Validate decolua/9router#2895 retry-delay overrides at the settings boundary. */
    if (Object.prototype.hasOwnProperty.call(body, "retryDelayByProvider")) {
      const overrides = body.retryDelayByProvider;
      const maxSeconds = MAX_RATE_LIMIT_COOLDOWN_MS / 1000;
      const prototype = overrides == null ? null : Object.getPrototypeOf(overrides);
      if (!overrides || !isObject(overrides) || Array.isArray(overrides) || prototype !== Object.prototype && prototype !== null) {
        return NextResponse.json({ error: "Invalid retryDelayByProvider" }, { status: 400, headers: SETTINGS_RESPONSE_HEADERS });
      }
      for (const [providerId, seconds] of Object.entries(overrides)) {
        if (!providerId || seconds !== "auto" && (!isNumber(seconds) || !Number.isFinite(seconds) || seconds <= 0 || seconds > maxSeconds)) {
          return NextResponse.json({ error: "Invalid retryDelayByProvider" }, { status: 400, headers: SETTINGS_RESPONSE_HEADERS });
        }
      }
    }
    if (Object.prototype.hasOwnProperty.call(body, "disabledFreeProviders")) {
      const ids = body.disabledFreeProviders;
      if (!Array.isArray(ids) || ids.some((id) => !isString(id))) {
        return NextResponse.json({ error: "Invalid disabledFreeProviders" }, { status: 400, headers: SETTINGS_RESPONSE_HEADERS });
      }
      const unknown = ids.filter((id) => !FREE_NO_AUTH_PROVIDER_IDS.includes(id));
      if (unknown.length > 0) {
        return NextResponse.json({ error: `Unknown free provider(s): ${unknown.join(", ")}` }, { status: 400, headers: SETTINGS_RESPONSE_HEADERS });
      }
      body.disabledFreeProviders = Array.from(new Set(ids));
    }
    /** Validate decolua/9router#3203 per-provider RPM overrides at the settings boundary. */
    if (Object.prototype.hasOwnProperty.call(body, "rpmByProvider")) {
      const overrides = body.rpmByProvider;
      if (!overrides || !isObject(overrides) || Array.isArray(overrides)) {
        return NextResponse.json({ error: "Invalid rpmByProvider" }, { status: 400, headers: SETTINGS_RESPONSE_HEADERS });
      }
      for (const [providerId, rpm] of Object.entries(overrides)) {
        if (!providerId || !Number.isSafeInteger(rpm) || rpm < 0 || rpm > MAX_PROVIDER_RPM) {
          return NextResponse.json({ error: "Invalid rpmByProvider" }, { status: 400, headers: SETTINGS_RESPONSE_HEADERS });
        }
      }
    }
    /**
     * Validate OmniRoute #11104 operator per-provider error rules. `match` is
     * always a plain substring compared case-insensitively -- never a RegExp
     * -- so an operator-supplied pattern can never introduce a ReDoS on the
     * error-classification hot path (open-sse/config/providerErrorRules.js).
     */
    if (Object.prototype.hasOwnProperty.call(body, "providerErrorRules")) {
      const rulesByProvider = body.providerErrorRules;
      const bad = () => NextResponse.json({ error: "Invalid providerErrorRules" }, { status: 400, headers: SETTINGS_RESPONSE_HEADERS });
      if (!rulesByProvider || !isObject(rulesByProvider) || Array.isArray(rulesByProvider)) return bad();
      let total = 0;
      for (const [providerId, list] of Object.entries(rulesByProvider)) {
        if (!isString(providerId) || !providerId.trim()) return bad();
        if (!Array.isArray(list)) return bad();
        for (const rule of list) {
          total += 1;
          if (!isObject(rule)) return bad();
          if (!Number.isInteger(rule.status) || rule.status < 100 || rule.status > 599) return bad();
          if (!isString(rule.match) || !rule.match.trim() || rule.match.length > 200) return bad();
          if (!["model", "provider", "connection"].includes(rule.scope)) return bad();
          if (rule.reason !== undefined && (!isString(rule.reason) || !rule.reason.trim())) return bad();
          if (rule.cooldownMs !== undefined && (!Number.isSafeInteger(rule.cooldownMs) || rule.cooldownMs < 0 || rule.cooldownMs > MAX_RATE_LIMIT_COOLDOWN_MS)) return bad();
        }
      }
      if (total > 50) return bad();
    }

    /** Validate OmniRoute #10920 egress-bucketed provider allowlist. */
    if (Object.prototype.hasOwnProperty.call(body, "egressBucketedProviders")) {
      const ids = body.egressBucketedProviders;
      if (!Array.isArray(ids) || ids.some((id) => !isString(id) || !id.trim())) {
        return NextResponse.json({ error: "Invalid egressBucketedProviders" }, { status: 400, headers: SETTINGS_RESPONSE_HEADERS });
      }
      body.egressBucketedProviders = Array.from(new Set(ids.map((id) => id.trim().toLowerCase())));
    }

    //   minContextWindow: integer 0..10_000_000 (optional)
    //   preferLargeContext: boolean (optional)
    //   contextFilterMode: "strict" | "lenient" (optional)
    // Reject unknown keys (upstream `.strict()`); a silently-normalized typo'd
    // config would otherwise mask a misconfigured combo. comboStrategies is an
    // object keyed by combo name; only objects carrying contextRequirements are
    // validated, other per-combo keys are untouched.
    if (Object.prototype.hasOwnProperty.call(body, "comboStrategies")) {
      const cs = body.comboStrategies;
      const bad = () => NextResponse.json({ error: "Invalid comboStrategies.contextRequirements" }, { status: 400, headers: SETTINGS_RESPONSE_HEADERS });
      if (!cs || !isObject(cs) || Array.isArray(cs)) return bad();
      const ALLOWED_KEYS = new Set(["minContextWindow", "preferLargeContext", "contextFilterMode"]);
      for (const cfg of Object.values(cs)) {
        if (!cfg || !isObject(cfg) || !Object.prototype.hasOwnProperty.call(cfg, "contextRequirements")) continue;
        const cr = cfg.contextRequirements;
        // Upstream `.strict().optional()`: absent key is fine, but an explicit
        // null is rejected (it is not a valid optional object).
        if (cr === undefined) continue;
        if (cr === null || !isObject(cr) || Array.isArray(cr)) return bad();
        for (const k of Object.keys(cr)) if (!ALLOWED_KEYS.has(k)) return bad();
        if (Object.prototype.hasOwnProperty.call(cr, "minContextWindow")) {
          // Upstream z.coerce.number() accepts numeric strings; coerce then bound.
          const v = Number(cr.minContextWindow);
          if (!Number.isSafeInteger(v) || v < 0 || v > 10_000_000) return bad();
          cr.minContextWindow = v; // store the coerced number
        }
        if (Object.prototype.hasOwnProperty.call(cr, "preferLargeContext") && !isBoolean(cr.preferLargeContext)) return bad();
        if (Object.prototype.hasOwnProperty.call(cr, "contextFilterMode") && cr.contextFilterMode !== "strict" && cr.contextFilterMode !== "lenient") return bad();
      }
    }

    // mediaRoutes: { [kind]: ["provider/model", ...] } — see shared/constants/mediaRoutes.js.
    if (Object.prototype.hasOwnProperty.call(body, "mediaRoutes")) {
      const routes = normalizeMediaRoutes(body.mediaRoutes);
      if (!routes) {
        return NextResponse.json({ error: "Invalid mediaRoutes" }, { status: 400, headers: SETTINGS_RESPONSE_HEADERS });
      }
      body.mediaRoutes = routes;
    }

    if (Object.prototype.hasOwnProperty.call(body, "enableProxyTimeline")
        && !isBoolean(body.enableProxyTimeline)) {
      return NextResponse.json({ error: "Invalid enableProxyTimeline" }, { status: 400, headers: SETTINGS_RESPONSE_HEADERS });
    }
    if (Object.prototype.hasOwnProperty.call(body, "proxyTimelineRetentionDays")) {
      const v = body.proxyTimelineRetentionDays;
      if (!Number.isInteger(v) || ![1, 3, 7].includes(v)) {
        return NextResponse.json({ error: "Invalid proxyTimelineRetentionDays" }, { status: 400, headers: SETTINGS_RESPONSE_HEADERS });
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, "dataRetentionEnabled")
        && !isBoolean(body.dataRetentionEnabled)) {
      return NextResponse.json({ error: "Invalid dataRetentionEnabled" }, { status: 400, headers: SETTINGS_RESPONSE_HEADERS });
    }

    // claudeClassifierCompat gates a default-allow short-circuit for Claude
    // Code's auto-permission classifier (open-sse/handlers/chatCore.js); an
    // unrecognized value must never fall through to a permissive default.
    if (Object.prototype.hasOwnProperty.call(body, "claudeClassifierCompat")
        && !["off", "auto", "always"].includes(body.claudeClassifierCompat)) {
      return NextResponse.json({ error: "Invalid claudeClassifierCompat" }, { status: 400, headers: SETTINGS_RESPONSE_HEADERS });
    }
    if (Object.prototype.hasOwnProperty.call(body, "dataRetentionDays")) {
      const v = body.dataRetentionDays;
      if (!Number.isInteger(v) || v < 1 || v > 3650) {
        return NextResponse.json({ error: "Invalid dataRetentionDays" }, { status: 400, headers: SETTINGS_RESPONSE_HEADERS });
      }
    }

    const modelAutoSyncError = validateModelAutoSyncSettingsPatch(body);
    if (modelAutoSyncError) {
      return NextResponse.json({ error: modelAutoSyncError }, { status: 400, headers: SETTINGS_RESPONSE_HEADERS });
    }

    const willChangePassword = body.password !== undefined;
    let settings;
    try {
      settings = willChangePassword ?
      await updateSettingsWithPasswordEpoch(body, expectedPasswordSessionEpoch) :
      await updateSettings(body);
    } catch (error) {
      if (error instanceof PasswordEpochMismatchError) {
        return NextResponse.json({ error: "Password change conflict, please retry" }, { status: 409, headers: SETTINGS_RESPONSE_HEADERS });
      }
      throw error;
    }
    if (willChangePassword) invalidateDefaultPasswordCache();
    if (willChangePassword) resetPasswordChangeProofs();
    if (willChangePassword) {
      try {
        await setDashboardAuthCookie(await cookies(), request, { passwordSessionEpoch }, passwordSessionEpoch);
      } catch (error) {
        if (error?.message === "AUTH_EPOCH_RACE") {
          return NextResponse.json({ error: "Password change conflict, please retry" }, { status: 409, headers: SETTINGS_RESPONSE_HEADERS });
        }
        console.error("[settings] password session cookie failed");
        return NextResponse.json({ reauthenticate: true }, { headers: SETTINGS_RESPONSE_HEADERS });
      }
    }


    // Apply outbound proxy settings immediately (no restart required)
    if (
    Object.prototype.hasOwnProperty.call(body, "outboundProxyEnabled") ||
    Object.prototype.hasOwnProperty.call(body, "outboundProxyUrl") ||
    Object.prototype.hasOwnProperty.call(body, "outboundNoProxy"))
    {
      applyOutboundProxyEnv(settings);
    }

    // Apply operator error-rule overrides immediately (no restart required)
    if (Object.prototype.hasOwnProperty.call(body, "providerErrorRules")) {
      setOperatorProviderErrorRules(settings.providerErrorRules);
    }

    // Invalidate combo rotation state when strategy settings change
    if (
    Object.prototype.hasOwnProperty.call(body, "comboStrategy") ||
    Object.prototype.hasOwnProperty.call(body, "comboStickyRoundRobinLimit") ||
    Object.prototype.hasOwnProperty.call(body, "comboStrategies"))
    {
      resetComboRotation();
      resetComboScoring();
    }

    // Write authority and read authority differ: an open local dashboard may
    // not flip auth-critical keys, but it must still see its own proxy URL
    // verbatim, because the value round-trips through the edit form.
    const { safeSettings } = sanitizeSettingsForResponse(settings, {
      privileged: await isOperatorRequest(request),
    });
    return NextResponse.json(safeSettings, { headers: SETTINGS_RESPONSE_HEADERS });
  } catch {
    console.error("[settings] update failed");
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500, headers: SETTINGS_RESPONSE_HEADERS });
  }
}
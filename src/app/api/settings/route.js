import { NextResponse } from "next/server";
import { FREE_NO_AUTH_PROVIDER_IDS } from "@/shared/constants/freeNoAuthProviders";
import { MAX_RATE_LIMIT_COOLDOWN_MS } from "open-sse/config/errorConfig.js";
import { MAX_PROVIDER_RPM } from "@/shared/constants/providers";
import { getSettings, updateSettings, updateSettingsWithPasswordEpoch, PasswordEpochMismatchError } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { resetComboRotation, resetComboScoring } from "open-sse/services/combo.js";
import { DEFAULT_PASSWORD, invalidateDefaultPasswordCache, setDashboardAuthCookie, validateDashboardPassword, verifyDashboardPassword } from "@/lib/auth/dashboardSession";
import { resetPasswordChangeProofs } from "@/lib/auth/passwordChangeProof";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import crypto from "node:crypto";
<<<<<<< HEAD
import {
  AUTH_CRITICAL_SETTING_KEYS,
  SECRET_SETTING_KEYS,
  canModifySecurityCriticalSettings,
  stripSettingKeys,
} from "@/lib/settings/settingsPatchAuth";
import { isBoolean, isNumber, isObject, isString } from "@/shared/utils/typeChecks.js";
=======
import { isBoolean, isNumber, isObject, isString } from "../../../shared/utils/typeChecks.js";
>>>>>>> 0bf1d704 (fix(ci): repair typeChecks imports for plain Node and CI gates)

const SETTINGS_RESPONSE_HEADERS = {
  "Cache-Control": "no-store"
};

const SCOPED_SETTING_KEYS = ["claudeAutoPing", "codexAutoPing"];

export async function GET() {
  try {
    const settings = await getSettings();
    const { password, passwordSessionEpoch, oidcClientSecret, mitmSudoEncrypted, ...safeSettings } = settings;
    safeSettings.oidcConfigured = !!(safeSettings.oidcIssuerUrl && safeSettings.oidcClientId && oidcClientSecret);

    const enableRequestLogs = process.env.ENABLE_REQUEST_LOGS === "true";
    const enableTranslator = process.env.ENABLE_TRANSLATOR === "true";

    return NextResponse.json({
      ...safeSettings,
      enableRequestLogs,
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

    // Invalidate combo rotation state when strategy settings change
    if (
    Object.prototype.hasOwnProperty.call(body, "comboStrategy") ||
    Object.prototype.hasOwnProperty.call(body, "comboStickyRoundRobinLimit") ||
    Object.prototype.hasOwnProperty.call(body, "comboStrategies"))
    {
      resetComboRotation();
      resetComboScoring();
    }

    const { password, oidcClientSecret, mitmSudoEncrypted, ...safeSettings } = settings;
    safeSettings.oidcConfigured = !!(safeSettings.oidcIssuerUrl && safeSettings.oidcClientId && oidcClientSecret);
    return NextResponse.json(safeSettings, { headers: SETTINGS_RESPONSE_HEADERS });
  } catch {
    console.error("[settings] update failed");
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500, headers: SETTINGS_RESPONSE_HEADERS });
  }
}
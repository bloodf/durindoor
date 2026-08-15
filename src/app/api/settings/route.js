import { NextResponse } from "next/server";
import { FREE_NO_AUTH_PROVIDER_IDS } from "@/shared/constants/freeNoAuthProviders";
import { getSettings, updateSettings, updateSettingsWithPasswordEpoch, PasswordEpochMismatchError } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { resetComboRotation, resetComboScoring } from "open-sse/services/combo.js";
import { DEFAULT_PASSWORD, invalidateDefaultPasswordCache, setDashboardAuthCookie, validateDashboardPassword, verifyDashboardPassword } from "@/lib/auth/dashboardSession";
import { resetPasswordChangeProofs } from "@/lib/auth/passwordChangeProof";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import crypto from "node:crypto";

const SETTINGS_RESPONSE_HEADERS = {
  "Cache-Control": "no-store"
};

// Secrets must never be mass-assigned from request body (CWE-915)
const PROTECTED_SETTING_KEYS = ["password", "mitmSudoEncrypted"];
const SCOPED_SETTING_KEYS = ["claudeAutoPing", "codexAutoPing"];

export async function GET() {
  try {
    const settings = await getSettings();
    const { password, oidcClientSecret, mitmSudoEncrypted, ...safeSettings } = settings;
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
        error: "Auto-ping must be updated through the connection-scoped endpoint",
      }, { status: 400, headers: SETTINGS_RESPONSE_HEADERS });
    }

    // Strip protected secrets before any internal handling sets them
    for (const key of PROTECTED_SETTING_KEYS) delete body[key];

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
    if (Object.prototype.hasOwnProperty.call(body, "pxpipeEnabled") && typeof body.pxpipeEnabled !== "boolean") {
      return NextResponse.json({ error: "Invalid pxpipeEnabled" }, { status: 400, headers: SETTINGS_RESPONSE_HEADERS });
    }
    if (Object.prototype.hasOwnProperty.call(body, "pxpipeAllowedModels")) {
      const raw = body.pxpipeAllowedModels;
      if (!Array.isArray(raw) || raw.some((m) => typeof m !== "string")) {
        return NextResponse.json({ error: "Invalid pxpipeAllowedModels" }, { status: 400, headers: SETTINGS_RESPONSE_HEADERS });
      }
      body.pxpipeAllowedModels = Array.from(new Set(raw.map((m) => m.trim()).filter(Boolean)));
    }
    // pxpipeAutoInstall was removed with runtime installs; strip so legacy
    // clients can't persist dead config.
    delete body.pxpipeAutoInstall;

    if (Object.prototype.hasOwnProperty.call(body, "disabledFreeProviders")) {
      const ids = body.disabledFreeProviders;
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
        return NextResponse.json({ error: "Invalid disabledFreeProviders" }, { status: 400, headers: SETTINGS_RESPONSE_HEADERS });
      }
      const unknown = ids.filter((id) => !FREE_NO_AUTH_PROVIDER_IDS.includes(id));
      if (unknown.length > 0) {
        return NextResponse.json({ error: `Unknown free provider(s): ${unknown.join(", ")}` }, { status: 400, headers: SETTINGS_RESPONSE_HEADERS });
      }
      body.disabledFreeProviders = Array.from(new Set(ids));
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
      if (!cs || typeof cs !== "object" || Array.isArray(cs)) return bad();
      const ALLOWED_KEYS = new Set(["minContextWindow", "preferLargeContext", "contextFilterMode"]);
      for (const cfg of Object.values(cs)) {
        if (!cfg || typeof cfg !== "object" || !Object.prototype.hasOwnProperty.call(cfg, "contextRequirements")) continue;
        const cr = cfg.contextRequirements;
        // Upstream `.strict().optional()`: absent key is fine, but an explicit
        // null is rejected (it is not a valid optional object).
        if (cr === undefined) continue;
        if (cr === null || typeof cr !== "object" || Array.isArray(cr)) return bad();
        for (const k of Object.keys(cr)) if (!ALLOWED_KEYS.has(k)) return bad();
        if (Object.prototype.hasOwnProperty.call(cr, "minContextWindow")) {
          // Upstream z.coerce.number() accepts numeric strings; coerce then bound.
          const v = Number(cr.minContextWindow);
          if (!Number.isSafeInteger(v) || v < 0 || v > 10_000_000) return bad();
          cr.minContextWindow = v; // store the coerced number
        }
        if (Object.prototype.hasOwnProperty.call(cr, "preferLargeContext") && typeof cr.preferLargeContext !== "boolean") return bad();
        if (Object.prototype.hasOwnProperty.call(cr, "contextFilterMode") && cr.contextFilterMode !== "strict" && cr.contextFilterMode !== "lenient") return bad();
      }
    }

    const willChangePassword = body.password !== undefined;
    let settings;
    try {
      settings = willChangePassword
        ? await updateSettingsWithPasswordEpoch(body, expectedPasswordSessionEpoch)
        : await updateSettings(body);
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
      Object.prototype.hasOwnProperty.call(body, "outboundNoProxy")
    ) {
      applyOutboundProxyEnv(settings);
    }

    // Invalidate combo rotation state when strategy settings change
    if (
      Object.prototype.hasOwnProperty.call(body, "comboStrategy") ||
      Object.prototype.hasOwnProperty.call(body, "comboStickyRoundRobinLimit") ||
      Object.prototype.hasOwnProperty.call(body, "comboStrategies")
    ) {
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

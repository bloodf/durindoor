import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { resetComboRotation, resetComboScoring } from "open-sse/services/combo.js";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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
  } catch (error) {
    console.log("Error getting settings:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
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

    // If updating password, hash it
    if (body.newPassword) {
      const settings = await getSettings();
      const currentHash = settings.password;

      // Verify current password if it exists
      if (currentHash) {
        if (!body.currentPassword) {
          return NextResponse.json({ error: "Current password required" }, { status: 400 });
        }
        const isValid = await bcrypt.compare(body.currentPassword, currentHash);
        if (!isValid) {
          return NextResponse.json({ error: "Invalid current password" }, { status: 401 });
        }
      } else {
        // First time setting password, no current password needed
        // Allow empty currentPassword or default "123456"
        if (body.currentPassword && body.currentPassword !== "123456") {
           return NextResponse.json({ error: "Invalid current password" }, { status: 401 });
        }
      }

      const salt = await bcrypt.genSalt(10);
      body.password = await bcrypt.hash(body.newPassword, salt);
      delete body.newPassword;
      delete body.currentPassword;
    }

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
    for (const key of ["pxpipeEnabled", "pxpipeAutoInstall"]) {
      if (Object.prototype.hasOwnProperty.call(body, key) && typeof body[key] !== "boolean") {
        return NextResponse.json({ error: `Invalid ${key}` }, { status: 400, headers: SETTINGS_RESPONSE_HEADERS });
      }
    }

    const settings = await updateSettings(body);

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
  } catch (error) {
    console.log("Error updating settings:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

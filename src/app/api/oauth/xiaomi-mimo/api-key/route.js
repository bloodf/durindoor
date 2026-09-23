import { NextResponse } from "next/server";
import { createProviderConnection, getProviderConnections, updateProviderConnection } from "@/models";
import { isObject, isString } from "@/shared/utils/typeChecks";

const DEFAULT_BASE_URL = "https://api.xiaomimimo.com/v1";
const REGIONS = new Set(["cn", "sgp", "ams", "ru", "in"]);
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

const str = (v) => (isString(v) && v.trim() ? v.trim() : null);

// The key is sent to baseUrl/models, so only Xiaomi's own hosts are allowed.
function isXiaomiApiUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && (u.hostname === "xiaomimimo.com" || u.hostname.endsWith(".xiaomimimo.com"));
  } catch {
    return false;
  }
}

async function validateKey(key, baseUrl) {
  try {
    const resp = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${key}`, "X-Mimo-Source": "mimocode-cli" },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return { validated: false, modelCount: 0 };
    const data = await resp.json().catch(() => null);
    return { validated: true, modelCount: Array.isArray(data?.data) ? data.data.length : 0 };
  } catch {
    // Network error: still store the key (it may be valid behind a blocked network).
    return { validated: false, modelCount: 0 };
  }
}

/**
 * POST /api/oauth/xiaomi-mimo/api-key
 * Store Xiaomi MiMo credentials from the dashboard auth modal.
 *
 * Body: { apiKey?, uid?, baseUrl?, mimoPassToken?, mimoUserId?, mimoCUserId?, region? }
 *
 * Two shapes:
 * - apiKey (sk-...), optionally with a Desktop passToken: an API-key connection
 *   (Desktop auto-import). The key is checked against /models first.
 * - mimoPassToken without apiKey: a session-only connection from the browser
 *   login. It serves the v2.6 models on the account route of `region`.
 *
 * An existing connection with the same uid, key, or session user+region is
 * updated in place instead of duplicated.
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || !isObject(body) || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const key = str(body.apiKey);
    const uid = str(body.uid);
    const mimoPassToken = str(body.mimoPassToken);
    const mimoUserId = str(body.mimoUserId);
    const mimoCUserId = str(body.mimoCUserId);
    const region = REGIONS.has(String(body.region || "").toLowerCase()) ? String(body.region).toLowerCase() : null;
    const sessionOnly = !key && !!mimoPassToken;

    if (!key && !mimoPassToken) {
      return NextResponse.json({ error: "API key or account session is required" }, { status: 400 });
    }
    if (key && !key.startsWith("sk-")) {
      return NextResponse.json({ error: "Invalid key format — expected sk- prefix" }, { status: 400 });
    }

    const baseUrl = (str(body.baseUrl) || DEFAULT_BASE_URL).replace(/\/+$/, "");
    if (!isXiaomiApiUrl(baseUrl)) {
      return NextResponse.json({ error: "baseUrl must be an https xiaomimimo.com URL" }, { status: 400 });
    }
    const { validated, modelCount } = key ? await validateKey(key, baseUrl) : { validated: false, modelCount: 0 };

    const existing = (await getProviderConnections({ provider: "xiaomi-mimo" })).find((c) => {
      const psd = c.providerSpecificData || {};
      if (uid && (c.email === `${uid}@xiaomi` || psd.uid === uid)) return true;
      if (key && (c.apiKey === key || c.accessToken === key)) return true;
      return sessionOnly && !!mimoUserId && psd.mimoUserId === mimoUserId &&
        (!region || (psd.region || "cn") === region);
    });

    if (existing) {
      const psd = existing.providerSpecificData || {};
      await updateProviderConnection(existing.id, {
        ...(key ? { apiKey: key } : null),
        providerSpecificData: {
          ...psd,
          uid: uid || psd.uid || null,
          baseUrl: key ? baseUrl : psd.baseUrl || baseUrl,
          region: region || psd.region || "cn",
          authMethod: sessionOnly ? "session" : psd.authMethod || "api_key",
          // Per-account session credential — lets several Xiaomi accounts rotate.
          mimoPassToken: mimoPassToken || psd.mimoPassToken || null,
          mimoUserId: mimoUserId || psd.mimoUserId || null,
          mimoCUserId: mimoCUserId || psd.mimoCUserId || null,
          modelCount,
        },
        testStatus: validated || sessionOnly ? "active" : existing.testStatus,
      });
      return NextResponse.json({
        success: true,
        validated,
        modelCount,
        updated: true,
        connection: { id: existing.id, provider: existing.provider, email: existing.email, name: existing.name },
      });
    }

    const connection = await createProviderConnection({
      provider: "xiaomi-mimo",
      // Session-only rows are "oauth" (imported credential), like Cursor imports.
      authType: sessionOnly ? "oauth" : "apikey",
      ...(key ? { apiKey: key } : null),
      accessToken: null,
      refreshToken: null,
      expiresAt: new Date(Date.now() + ONE_YEAR_MS).toISOString(),
      email: uid ? `${uid}@xiaomi` : null,
      name: uid ? `Xiaomi ${uid}${sessionOnly ? " (Session)" : ""}` : "Xiaomi MiMo",
      providerSpecificData: {
        uid,
        baseUrl,
        authMethod: sessionOnly ? "session" : "api_key",
        region: region || "cn",
        modelCount,
        mimoPassToken,
        mimoUserId,
        mimoCUserId,
      },
      testStatus: validated || sessionOnly ? "active" : "untested",
    });

    return NextResponse.json({
      success: true,
      validated,
      modelCount,
      connection: { id: connection.id, provider: connection.provider, email: connection.email, name: connection.name },
    });
  } catch (error) {
    console.log("[xiaomi-mimo] credential import error:", error?.message || error);
    return NextResponse.json({ error: "Xiaomi MiMo import failed" }, { status: 500 });
  }
}

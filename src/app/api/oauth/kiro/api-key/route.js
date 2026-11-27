import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { KiroService } from "@/lib/oauth/services/kiro";
import { createProviderConnection } from "@/lib/localDb";
import { resolveOAuthProxySelection } from "@/lib/oauth/proxySelection.js";
import { ensureOutboundProxyInitialized } from "@/lib/network/initOutboundProxy";
import { normalizeKiroRegion } from "open-sse/config/kiroRegions.js";
import { isString } from "../../../../../shared/utils/typeChecks.js";

// Identical submissions that are still in flight share one validation and one
// stored connection, so a double submit cannot create two rows.
const inFlightImports = new Map();

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function importKey(apiKey, region, selection) {
  const digest = createHash("sha256").update(apiKey).digest("hex");
  return JSON.stringify([digest, region, selection?.mode || "legacy", selection?.poolId || null]);
}

async function importApiKey(kiroService, apiKey, region, resolvedProxy) {
  // Validate on Amazon Q; profile discovery is best-effort. An explicit proxy
  // selection carries the same egress for validation and later requests.
  const credential = resolvedProxy ?
    await kiroService.validateApiKey(apiKey, region, resolvedProxy.proxyOptions) :
    await kiroService.validateApiKey(apiKey, region);

  // Extract email from JWT if the key happens to be a JWT (optional display)
  const email = kiroService.extractEmailFromJWT(credential.accessToken);

  // API keys never expire on a fixed schedule; persist a long horizon so the
  // proactive refresh path (which requires a refreshToken anyway) is skipped.
  return createProviderConnection({
    provider: "kiro",
    authType: "api_key",
    accessToken: credential.accessToken,
    refreshToken: null,
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    email: email || null,
    providerSpecificData: {
      profileArn: credential.profileArn,
      region: credential.region,
      authMethod: "api_key",
      provider: "API Key",
      ...(resolvedProxy ? resolvedProxy.metadataPatch : null)
    },
    testStatus: "active"
  });
}

/**
 * POST /api/oauth/kiro/api-key
 * Import a Kiro API key (headless auth). The key is a long-lived bearer
 * credential — there is no refresh token. It is validated on the Amazon Q
 * model catalog, then stored with authMethod="api_key".
 * Optional `proxyMode` / `proxyPoolId` select the egress used for validation
 * and stored on the connection, as the OAuth sign-in routes do.
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { apiKey, region } = body || {};

    if (!apiKey || !isString(apiKey) || !apiKey.trim()) {
      return NextResponse.json(
        { error: "API key is required" },
        { status: 400 }
      );
    }

    let safeRegion;
    try {
      // Region is interpolated into an AWS hostname downstream; reject it at
      // the request boundary before credential validation opens a socket.
      safeRegion = !region || region === "auto" ? "auto" : normalizeKiroRegion(region);
    } catch (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    let resolvedProxy = null;
    if (hasOwn(body, "proxyMode") || hasOwn(body, "proxyPoolId")) {
      try {
        await ensureOutboundProxyInitialized();
        const selectionInput = {};
        if (hasOwn(body, "proxyMode")) selectionInput.proxyMode = body.proxyMode;
        if (hasOwn(body, "proxyPoolId")) selectionInput.proxyPoolId = body.proxyPoolId;
        resolvedProxy = await resolveOAuthProxySelection(selectionInput);
      } catch {
        return NextResponse.json({ error: "Invalid proxy selection" }, { status: 400 });
      }
    }

    const trimmedKey = apiKey.trim();
    const key = importKey(trimmedKey, safeRegion, resolvedProxy?.selection);
    let pending = inFlightImports.get(key);
    if (!pending) {
      pending = importApiKey(new KiroService(), apiKey, safeRegion, resolvedProxy);
      inFlightImports.set(key, pending);
      pending.then(
        () => inFlightImports.delete(key),
        () => inFlightImports.delete(key)
      );
    }
    const connection = await pending;

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email
      }
    });
  } catch (error) {
    // Log only the message: service errors carry status and code, never bodies.
    console.log("Kiro API key import error:", error?.message || "unknown error");
    // Do not reflect upstream response body to the client (SSRF hardening)
    return NextResponse.json(
      { error: "API key validation failed" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { resolveKiroCredentialsFromSsoCache } from "open-sse/services/kiroModels.js";
import { normalizeKiroRegion } from "open-sse/config/kiroRegions.js";

/**
 * GET /api/oauth/kiro/auto-import
 * Auto-detect and extract Kiro refresh token from the AWS SSO cache.
 * Delegates to the unified SSO cache resolver (DurinDoor PR #2615), which
 * accepts Builder ID, external_idp (Microsoft Entra), and organization
 * (codewhisperer-scoped) tokens; resolves clientId/clientSecret from the
 * linked client registration file; and returns the profileArn verbatim.
 */
export async function GET() {
  try {
    const { refreshToken, source, clientId, clientSecret, region, authMethod, profileArn, rawAuth } =
    await resolveKiroCredentialsFromSsoCache();

    let safeRegion;
    try {
      // Local cache JSON is untrusted input and the dashboard sends this value
      // back to an endpoint that interpolates it into an AWS hostname.
      safeRegion = normalizeKiroRegion(region || "us-east-1");
    } catch {
      safeRegion = "us-east-1";
    }

    return NextResponse.json({
      found: true,
      refreshToken,
      source,
      clientId,
      clientSecret,
      region: safeRegion,
      authMethod,
      profileArn,
      // Full CLIProxyAPI-shaped auth payload for external_idp tokens so the
      // import handoff carries clientId/tokenEndpoint/scopes (#2615).
      ...(rawAuth ? { rawAuth } : null)
    });
  } catch (error) {
    // Cache unreadable or no Kiro token cached: report found:false with 200,
    // the contract the dashboard auto-detect expects.
    console.log("Kiro auto-import:", error?.message || error);
    return NextResponse.json({
      found: false,
      error: error?.message || String(error)
    });
  }
}
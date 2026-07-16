import { NextResponse } from "next/server";
import { resolveKiroCredentialsFromSsoCache } from "open-sse/services/kiroModels.js";

/**
 * GET /api/oauth/kiro/auto-import
 * Auto-detect and extract Kiro refresh token from the AWS SSO cache.
 * Delegates to the unified SSO cache resolver (9router PR #2615), which
 * accepts Builder ID, external_idp (Microsoft Entra), and organization
 * (codewhisperer-scoped) tokens; resolves clientId/clientSecret from the
 * linked client registration file; and returns the profileArn verbatim.
 */
export async function GET() {
  try {
    const { refreshToken, source, clientId, clientSecret, region, authMethod, profileArn, rawAuth } =
      await resolveKiroCredentialsFromSsoCache();

    return NextResponse.json({
      found: true,
      refreshToken,
      source,
      clientId,
      clientSecret,
      region,
      authMethod,
      profileArn,
      // Full CLIProxyAPI-shaped auth payload for external_idp tokens so the
      // import handoff carries clientId/tokenEndpoint/scopes (#2615).
      ...(rawAuth ? { rawAuth } : {}),
    });
  } catch (error) {
    // Cache unreadable or no Kiro token cached: report found:false with 200,
    // the contract the dashboard auto-detect expects.
    console.log("Kiro auto-import:", error?.message || error);
    return NextResponse.json({
      found: false,
      error: error?.message || String(error),
    });
  }
}

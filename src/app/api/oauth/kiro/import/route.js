import { NextResponse } from "next/server";
import { KiroService } from "@/lib/oauth/services/kiro";
import { createProviderConnection } from "@/models";
import { normalizeKiroExternalIdpAuth } from "@/lib/oauth/kiroExternalIdp";
import { resolveKiroCredentialsFromSsoCache } from "open-sse/services/kiroModels.js";

/**
 * POST /api/oauth/kiro/import
 * Import and validate refresh token from Kiro IDE.
 * For IDC (organization) tokens, accepts clientId/clientSecret/region so the
 * token can be refreshed via the regional AWS OIDC endpoint.
 */
export async function POST(request) {
  try {
    const { refreshToken, clientId, clientSecret, region, authMethod, profileArn } = await request.json();

    if (!refreshToken || typeof refreshToken !== "string") {
      return NextResponse.json(
        { error: "Refresh token is required" },
        { status: 400 }
      );
    }

    const kiroService = new KiroService();
    const isIdc = !!(clientId && clientSecret);

    // For IDC tokens, refresh via the regional OIDC endpoint with client credentials.
    // For social/builder-id tokens, use the standard social refresh endpoint.
    let resolvedProviderData = isIdc
      ? { clientId, clientSecret, region: region || "us-east-1", authMethod: "idc" }
      : {};

    let resolvedProfileArn = profileArn || null;

    // Unified SSO cache resolution (DurinDoor PR #2615): if the pasted refresh
    // token matches a local AWS SSO cache entry that declares external_idp
    // (Microsoft Entra), validate it against the Microsoft token endpoint
    // instead of the AWS OIDC / social endpoints, which reject such tokens.
    // Only the cache LOOKUP failures fall through to the standard flow; an
    // exact-match entry declaring external_idp with invalid metadata (bad
    // endpoint, missing fields) must fail closed, not silently retry against
    // AWS/social endpoints.
    let cacheResult = null;
    try {
      cacheResult = await resolveKiroCredentialsFromSsoCache(refreshToken.trim());
    } catch (cacheError) {
      // Cache unavailable or token not cached — proceed with standard flow.
    }
    if (cacheResult?.authMethod === "external_idp" && cacheResult.rawAuth) {
      // Throws on invalid metadata (e.g. non-Microsoft token endpoint).
      const normalized = normalizeKiroExternalIdpAuth(cacheResult.rawAuth);
      resolvedProviderData = normalized.providerSpecificData;
      resolvedProfileArn = normalized.providerSpecificData.profileArn || resolvedProfileArn;
    }

    const tokenData = await kiroService.refreshToken(refreshToken.trim(), resolvedProviderData);

    const email = kiroService.extractEmailFromJWT(tokenData.accessToken);
    const resolvedAuthMethod = tokenData.providerSpecificData?.authMethod || (isIdc ? "idc" : "imported");
    const providerLabel = tokenData.providerSpecificData?.provider || (isIdc ? "Enterprise" : "Imported");
    resolvedProfileArn = resolvedProfileArn || tokenData.providerSpecificData?.profileArn || tokenData.profileArn || null;

    const connection = await createProviderConnection({
      provider: "kiro",
      authType: "oauth",
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken || refreshToken.trim(),
      expiresAt: new Date(Date.now() + (tokenData.expiresIn || 3600) * 1000).toISOString(),
      email: email || null,
      providerSpecificData: {
        profileArn: resolvedProfileArn,
        authMethod: resolvedAuthMethod,
        provider: providerLabel,
        ...(isIdc ? { clientId, clientSecret, region: region || "us-east-1" } : {}),
        // Persist the full external_idp metadata (clientId, tokenEndpoint,
        // scope) so later runtime refreshes stay on the Microsoft endpoint.
        ...(tokenData.providerSpecificData?.authMethod === "external_idp" ? tokenData.providerSpecificData : {}),
      },
      testStatus: "active",
    });

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email,
      },
    });
  } catch (error) {
    console.log("Kiro import token error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

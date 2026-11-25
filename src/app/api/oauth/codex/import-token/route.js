import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";
import { extractCodexAccountInfo } from "@/lib/oauth/providers";
import { CODEX_FINGERPRINT_MODES } from "open-sse/config/codexIdentity.js";

/**
 * POST /api/oauth/codex/import-token
 * Import a ChatGPT access token (created from chatgpt.com settings)
 * as a provider connection, bypassing OAuth refresh flow.
 *
 * Body: { accessToken: string, refreshToken?: string, name?: string }
 * With a refreshToken the connection is stored as a refreshable oauth login.
 */
import { isString } from "../../../../../shared/utils/typeChecks.js";
export async function POST(request) {
  try {
    const { accessToken, refreshToken: rawRefreshToken, name, codexFingerprintMode } = await request.json();

    if (!accessToken || !isString(accessToken)) {
      return NextResponse.json(
        { error: "Access token is required" },
        { status: 400 }
      );
    }

    const token = accessToken.trim();
    const refreshToken = isString(rawRefreshToken) && rawRefreshToken.trim() ? rawRefreshToken.trim() : null;
    let expiresAt = null;

    // Extract account info from the JWT (email, workspace, plan)
    let email = null;
    let providerSpecificData = { authMethod: refreshToken ? "oauth" : "access_token" };
    if (CODEX_FINGERPRINT_MODES.includes(codexFingerprintMode)) {
      providerSpecificData.codexFingerprintMode = codexFingerprintMode;
    } else {
      providerSpecificData.codexFingerprintMode = "session";
    }

    // Try decoding as JWT to extract email + workspace
    try {
      const parts = token.split(".");
      if (parts.length === 3) {
        const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const missingPadding = (4 - base64.length % 4) % 4;
        const padded = base64 + "=".repeat(missingPadding);
        const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));

        // Extract from OpenAI JWT structure
        const auth = payload["https://api.openai.com/auth"] || {};
        const profile = payload["https://api.openai.com/profile"] || {};
        email = profile.email || payload.email || payload.preferred_username || null;

        if (auth.chatgpt_account_id) {
          providerSpecificData.chatgptAccountId = auth.chatgpt_account_id;
        }
        if (auth.chatgpt_plan_type) {
          providerSpecificData.chatgptPlanType = auth.chatgpt_plan_type;
        }

        // Store expiry info from JWT if available
        if (payload.exp) {
          providerSpecificData.jwtExp = payload.exp;
          expiresAt = new Date(payload.exp * 1000).toISOString();
        }
      }
    } catch {

      // Not a JWT or malformed — still allow import as raw token
    }
    // Also try extractCodexAccountInfo via id_token-style extraction
    // (the access token itself may contain the same claims)
    if (!email) {
      const info = extractCodexAccountInfo(token);
      if (info.email) email = info.email;
      if (info.chatgptAccountId) providerSpecificData.chatgptAccountId = info.chatgptAccountId;
      if (info.chatgptPlanType) providerSpecificData.chatgptPlanType = info.chatgptPlanType;
    }

    const connectionName = name || email || "ChatGPT Access Token";

    // Save to database: refreshable oauth with a refresh token, else access_token (no refresh)
    const connection = await createProviderConnection({
      provider: "codex",
      authType: refreshToken ? "oauth" : "access_token",
      accessToken: token,
      ...(refreshToken && { refreshToken }),
      ...(expiresAt && { expiresAt }),
      name: connectionName,
      email: email,
      providerSpecificData,
      testStatus: "active"
    });

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email,
        name: connection.name,
        workspace: providerSpecificData.chatgptAccountId || null,
        plan: providerSpecificData.chatgptPlanType || null
      }
    });
  } catch (error) {
    console.log("Codex access token import error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
import "open-sse/utils/proxyFetch.js";

import { sanitizeErrorMessage } from "open-sse/utils/error.js";
import { NextResponse } from "next/server";

import {
  resolveFlowProxySelection,
  saveOAuthConnection,
} from "@/lib/oauth/flowCompletion.js";
import { claimOAuthFlow, consumeOAuthFlow } from "@/lib/oauth/flowStore.js";
import { KiroService } from "@/lib/oauth/services/kiro";
import { ensureOutboundProxyInitialized } from "@/lib/network/initOutboundProxy";

/** Exchange a Kiro social code using only server-bound flow metadata. */
export async function POST(request) {
  let claim = null;
  try {
    await ensureOutboundProxyInitialized();
    const body = await request.json();
    const code = typeof body?.code === "string" ? body.code.trim() : "";
    const state = typeof body?.state === "string" ? body.state.trim() : "";
    const flowId = typeof body?.flowId === "string" ? body.flowId.trim() : "";
    if (!code || !state || !flowId) throw new Error("Missing required fields");

    claim = claimOAuthFlow({ flowId, state, provider: "kiro" });
    if (!claim || claim.kind !== "authorization" || !claim.payload.socialProvider) {
      throw new Error("OAuth session expired, was cancelled, or was already used");
    }
    const resolvedProxy = await resolveFlowProxySelection(claim);
    const service = new KiroService();
    const tokens = await service.exchangeSocialCode(
      code,
      claim.payload.codeVerifier,
      resolvedProxy.proxyOptions,
    );
    const email = service.extractEmailFromJWT(tokens.accessToken);
    const socialProvider = claim.payload.socialProvider;
    const connection = await saveOAuthConnection(
      "kiro",
      {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
        email: email || null,
        providerSpecificData: {
          profileArn: tokens.profileArn,
          authMethod: socialProvider,
          provider: socialProvider.charAt(0).toUpperCase() + socialProvider.slice(1),
        },
      },
      resolvedProxy,
      {},
      claim,
    );

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email,
      },
    });
  } catch (error) {
    const message = sanitizeErrorMessage(error?.message || "Social token exchange failed");
    console.error(`[OAuth] kiro/social-exchange failed: ${message}`);
    return NextResponse.json({ error: message }, { status: 400 });
  } finally {
    if (claim) consumeOAuthFlow(claim);
  }
}

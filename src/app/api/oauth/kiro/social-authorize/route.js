import "open-sse/utils/proxyFetch.js";

import { sanitizeErrorMessage } from "open-sse/utils/error.js";
import { NextResponse } from "next/server";

import {
  beginOAuthFlowIntent,
  createOAuthFlow,
} from "@/lib/oauth/flowStore.js";
import { resolveOAuthProxySelection } from "@/lib/oauth/proxySelection.js";
import { KiroService } from "@/lib/oauth/services/kiro";
import { generatePKCE } from "@/lib/oauth/utils/pkce";
import { ensureOutboundProxyInitialized } from "@/lib/network/initOutboundProxy";

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

async function beginSocialAuthorization(input) {
  const socialProvider = input.provider;
  if (!['google', 'github'].includes(socialProvider)) {
    throw new Error("Invalid provider. Use 'google' or 'github'");
  }
  const intent = beginOAuthFlowIntent("kiro", input.ownerId);
  const selectionInput = {};
  if (hasOwn(input, "proxyMode")) selectionInput.proxyMode = input.proxyMode;
  if (hasOwn(input, "proxyPoolId")) selectionInput.proxyPoolId = input.proxyPoolId;
  const resolvedProxy = await resolveOAuthProxySelection(selectionInput);
  const { codeVerifier, codeChallenge, state } = generatePKCE();
  const authUrl = new KiroService().buildSocialLoginUrl(
    socialProvider,
    codeChallenge,
    state,
  );

  const flow = createOAuthFlow({
    provider: "kiro",
    state,
    kind: "authorization",
    payload: {
      codeVerifier,
      socialProvider,
      proxySelection: resolvedProxy.selection,
    },
    intent,
  });
  return {
    authUrl,
    state,
    flowId: flow.flowId,
    expiresAt: flow.expiresAt,
    provider: socialProvider,
  };
}

/** Legacy GET compatibility; the dashboard uses POST to avoid query secrets. */
export async function GET(request) {
  try {
    await ensureOutboundProxyInitialized();
    const { searchParams } = new URL(request.url);
    return NextResponse.json(await beginSocialAuthorization({
      provider: searchParams.get("provider"),
      ...(searchParams.has("proxyMode") ? { proxyMode: searchParams.get("proxyMode") } : {}),
      ...(searchParams.has("proxyPoolId") ? { proxyPoolId: searchParams.get("proxyPoolId") } : {}),
    }));
  } catch (error) {
    const message = sanitizeErrorMessage(error?.message || "Social authorization failed");
    console.error(`[OAuth] kiro/social-authorize failed: ${message}`);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** Start a server-bound Kiro social OAuth flow. */
export async function POST(request) {
  try {
    await ensureOutboundProxyInitialized();
    const body = await request.json();
    return NextResponse.json(await beginSocialAuthorization(body || {}));
  } catch (error) {
    const message = sanitizeErrorMessage(error?.message || "Social authorization failed");
    console.error(`[OAuth] kiro/social-authorize failed: ${message}`);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

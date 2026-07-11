import "open-sse/utils/proxyFetch.js";

import { sanitizeErrorMessage } from "open-sse/utils/error.js";
import { NextResponse } from "next/server";

import {
  exchangeAndSaveAuthorizationCode,
  saveOAuthConnection,
  withOAuthProxyMetadata,
} from "@/lib/oauth/flowCompletion.js";
import {
  cancelOAuthFlow,
  beginOAuthFlowIntent,
  claimOAuthFlow,
  consumeOAuthFlow,
  createOAuthFlow,
  getOAuthFlow,
  isOAuthFlowClaimActive,
  settleOAuthFlowClaim,
} from "@/lib/oauth/flowStore.js";
import {
  extractCodexAccountInfo,
  generateAuthData,
  getProvider,
  pollForToken,
  requestDeviceCode,
} from "@/lib/oauth/providers.js";
import { resolveOAuthProxySelection } from "@/lib/oauth/proxySelection.js";
import { ensureOutboundProxyInitialized } from "@/lib/network/initOutboundProxy";
import {
  clearCodexSession,
  clearXaiSession,
  getCodexSessionStatus,
  getXaiSessionStatus,
  registerCodexSession,
  registerXaiSession,
  startCodexProxy,
  startXaiProxy,
  stopCodexProxy,
  stopXaiProxy,
} from "@/lib/oauth/utils/server";
import { createProviderConnection } from "@/models";

const NO_PKCE_DEVICE_PROVIDERS = new Set([
  "github",
  "kiro",
  "kimi-coding",
  "kilocode",
  "codebuddy-cn",
  "qoder",
  "grok-cli",
]);

const NO_PKCE_POLL_PROVIDERS = new Set([
  "github",
  "kimi-coding",
  "kilocode",
  "codebuddy-cn",
]);

const PUBLIC_DEVICE_FIELDS = [
  "user_code",
  "verification_uri",
  "verification_uri_complete",
  "verification_url",
  "verification_url_complete",
  "expires_in",
  "interval",
];
const fixedProxyOperations = new Map();
const SAFE_GET_META_KEYS = new Set(["baseUrl", "clientId"]);
const OAUTH_ERROR_STATUS = Object.freeze({
  OAUTH_VALIDATION_FAILED: 400,
  OAUTH_STATE_MISMATCH: 400,
  OAUTH_FLOW_CONFLICT: 409,
  OAUTH_SESSION_GONE: 410,
  OAUTH_UPSTREAM_FAILURE: 502,
});

class OAuthRouteError extends Error {
  constructor(code, message, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = "OAuthRouteError";
    this.code = code;
  }
}

function oauthRouteError(code, message, cause = null) {
  return new OAuthRouteError(code, message, cause);
}

function requireOAuthProvider(provider) {
  try {
    return getProvider(provider);
  } catch (error) {
    throw oauthRouteError(
      "OAUTH_VALIDATION_FAILED",
      "Unsupported OAuth provider",
      error,
    );
  }
}

async function callOAuthUpstream(operation) {
  try {
    return await operation();
  } catch (error) {
    if (typeof error?.code === "string" && error.code.startsWith("OAUTH_")) throw error;
    throw oauthRouteError(
      "OAUTH_UPSTREAM_FAILURE",
      error?.message || "OAuth provider request failed",
      error,
    );
  }
}

function createBoundOAuthFlow(options) {
  try {
    return createOAuthFlow(options);
  } catch (error) {
    if (/superseded|already exists/i.test(error?.message || "")) {
      throw oauthRouteError(
        "OAUTH_FLOW_CONFLICT",
        error.message,
        error,
      );
    }
    throw error;
  }
}

function claimBoundOAuthFlow({ flowId, state = null, provider, kind }) {
  const current = getOAuthFlow({ flowId, provider });
  if (!current) {
    const unscoped = getOAuthFlow({ flowId });
    if (unscoped && unscoped.provider !== provider) {
      throw oauthRouteError(
        "OAUTH_VALIDATION_FAILED",
        "OAuth provider did not match this flow",
      );
    }
    throw oauthRouteError(
      "OAUTH_SESSION_GONE",
      "OAuth session expired, was cancelled, or was already used",
    );
  }
  if (state && current.state !== state) {
    throw oauthRouteError(
      "OAUTH_STATE_MISMATCH",
      "OAuth state did not match this flow",
    );
  }
  if (current.kind !== kind) {
    throw oauthRouteError(
      "OAUTH_VALIDATION_FAILED",
      "OAuth flow type did not match this operation",
    );
  }
  if (current.status !== "active") {
    throw oauthRouteError(
      "OAUTH_FLOW_CONFLICT",
      "OAuth flow is already being processed",
    );
  }

  const claim = claimOAuthFlow({ flowId, state: state || undefined, provider });
  if (claim) return claim;

  const remaining = getOAuthFlow({ flowId, provider });
  throw oauthRouteError(
    remaining ? "OAUTH_FLOW_CONFLICT" : "OAUTH_SESSION_GONE",
    remaining
      ? "OAuth flow is already being processed"
      : "OAuth session expired, was cancelled, or was already used",
  );
}

function normalizeOAuthCompletionError(error) {
  if (error?.code) return error;
  if (/cancelled or superseded before commit/i.test(error?.message || "")) {
    return oauthRouteError("OAUTH_SESSION_GONE", error.message, error);
  }
  return error;
}

async function withFixedProxyOperation(provider, operation) {
  const previous = fixedProxyOperations.get(provider) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  fixedProxyOperations.set(provider, current);
  try {
    return await current;
  } finally {
    if (fixedProxyOperations.get(provider) === current) {
      fixedProxyOperations.delete(provider);
    }
  }
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}
function proxySelectionInput(source) {
  const selection = {};
  if (hasOwn(source, "proxyMode")) selection.proxyMode = source.proxyMode;
  if (hasOwn(source, "proxyPoolId")) selection.proxyPoolId = source.proxyPoolId;
  return selection;
}

function searchProxySelection(searchParams) {
  const selection = {};
  if (searchParams.has("proxyMode")) selection.proxyMode = searchParams.get("proxyMode");
  if (searchParams.has("proxyPoolId")) selection.proxyPoolId = searchParams.get("proxyPoolId");
  return selection;
}

function publicConnection(connection, includeIdentity = true) {
  return {
    id: connection.id,
    provider: connection.provider,
    ...(includeIdentity
      ? { email: connection.email, displayName: connection.displayName }
      : {}),
  };
}

function publicDeviceData(deviceData, flow) {
  const response = { flowId: flow.flowId, expiresAt: flow.expiresAt };
  for (const key of PUBLIC_DEVICE_FIELDS) {
    if (deviceData?.[key] !== undefined) response[key] = deviceData[key];
  }
  return response;
}

function internalDeviceData(deviceData) {
  const values = Object.fromEntries(
    Object.entries(deviceData || {}).filter(([key]) => key.startsWith("_")),
  );
  return Object.keys(values).length ? values : null;
}

function oauthErrorResponse(error, operation) {
  const message = sanitizeErrorMessage(error?.message || "OAuth request failed");
  console.error(`[OAuth] ${operation} failed: ${message}`);
  const status = OAUTH_ERROR_STATUS[error?.code] ||
    (typeof error?.code === "string" && error.code.startsWith("OAUTH_PROXY_") ? 400 : 500);
  return NextResponse.json({ error: message }, { status });
}

async function beginAuthorization(provider, input) {
  requireOAuthProvider(provider);
  const intent = beginOAuthFlowIntent(provider, input.ownerId);
  const redirectUri = input.redirectUri || input.redirect_uri || "http://localhost:8080/callback";
  const meta = input.meta && typeof input.meta === "object" ? input.meta : undefined;
  const resolvedProxy = await resolveOAuthProxySelection(proxySelectionInput(input));
  const authData = await generateAuthData(
    provider,
    redirectUri,
    meta,
    resolvedProxy.proxyOptions,
  );

  const flow = createBoundOAuthFlow({
    provider,
    state: authData.state,
    kind: "authorization",
    payload: {
      codeVerifier: authData.codeVerifier,
      redirectUri,
      meta,
      proxySelection: resolvedProxy.selection,
    },
    intent,
  });

  return {
    authUrl: authData.authUrl,
    state: authData.state,
    flowId: flow.flowId,
    expiresAt: flow.expiresAt,
    flowType: authData.flowType,
    fixedPort: authData.fixedPort,
    callbackPath: authData.callbackPath,
  };
}

async function beginDeviceCode(provider, input) {
  const providerData = requireOAuthProvider(provider);
  if (providerData.flowType !== "device_code") {
    throw oauthRouteError(
      "OAUTH_VALIDATION_FAILED",
      "Provider does not support device code flow",
    );
  }
  const intent = beginOAuthFlowIntent(provider, input.ownerId);

  const resolvedProxy = await resolveOAuthProxySelection(proxySelectionInput(input));
  const authData = await generateAuthData(provider, null, undefined, resolvedProxy.proxyOptions);
  const deviceOptions = provider === "kiro"
    ? {
        ...(input.startUrl ? { startUrl: input.startUrl } : {}),
        ...(input.region ? { region: input.region } : {}),
        ...(input.authMethod ? { authMethod: input.authMethod } : {}),
      }
    : undefined;
  const deviceData = await callOAuthUpstream(() => requestDeviceCode(
      provider,
      NO_PKCE_DEVICE_PROVIDERS.has(provider) ? undefined : authData.codeChallenge,
      deviceOptions,
      resolvedProxy.proxyOptions,
    ),
  );
  if (!deviceData?.device_code) {
    throw oauthRouteError(
      "OAUTH_UPSTREAM_FAILURE",
      "OAuth provider returned an invalid device response",
    );
  }

  const flow = createBoundOAuthFlow({
    provider,
    kind: "device",
    ttlMs: Number(deviceData?.expires_in) * 1000,
    payload: {
      deviceCode: deviceData?.device_code,
      codeVerifier: deviceData?.codeVerifier || authData.codeVerifier,
      extraData: internalDeviceData(deviceData),
      proxySelection: resolvedProxy.selection,
    },
    intent,
  });
  return publicDeviceData(deviceData, flow);
}

async function completeAccessToken(provider, code, resolvedProxy, flowClaim) {
  const info = extractCodexAccountInfo(code);
  let directPayload = {};
  try {
    const encoded = code.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = encoded + "=".repeat((4 - (encoded.length % 4)) % 4);
    directPayload = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    // Token parsing is best-effort; the opaque token can still be imported.
  }

  const providerSpecificData = withOAuthProxyMetadata(
    {
      authMethod: "access_token",
      ...(info.chatgptAccountId || directPayload.account_id
        ? { chatgptAccountId: info.chatgptAccountId || directPayload.account_id }
        : {}),
      ...(info.chatgptPlanType || directPayload.plan_type
        ? { chatgptPlanType: info.chatgptPlanType || directPayload.plan_type }
        : {}),
    },
    resolvedProxy,
  );
  return createProviderConnection({
    provider,
    authType: "access_token",
    accessToken: code,
    email: info.email || directPayload.email || null,
    providerSpecificData,
    testStatus: "active",
  }, {
    shouldCommit: () => isOAuthFlowClaimActive(flowClaim),
  });
}

async function completeAuthorization(provider, input) {
  const code = typeof input.code === "string" ? input.code.trim() : "";
  const state = typeof input.state === "string" ? input.state.trim() : "";
  const flowId = typeof input.flowId === "string" ? input.flowId.trim() : "";
  if (!code || !state || !flowId) {
    throw oauthRouteError("OAUTH_VALIDATION_FAILED", "Missing required fields");
  }

  const claim = claimBoundOAuthFlow({ flowId, state, provider, kind: "authorization" });
  try {
    if (code.startsWith("eyJ") && code.includes(".")) {
      const resolvedProxy = await resolveOAuthProxySelection(claim.payload.proxySelection);
      // Await before finally consumes the claim so the DB's shouldCommit guard
      // remains active through the actual write.
      return await completeAccessToken(provider, code, resolvedProxy, claim);
    }
    const { connection } = await exchangeAndSaveAuthorizationCode(provider, code, state, claim);
    return connection;
  } catch (error) {
    throw normalizeOAuthCompletionError(error);
  } finally {
    consumeOAuthFlow(claim);
  }
}

async function pollDeviceCode(provider, input) {
  const flowId = typeof input.flowId === "string" ? input.flowId.trim() : "";
  if (!flowId) {
    throw oauthRouteError("OAUTH_VALIDATION_FAILED", "Missing OAuth flow ID");
  }
  const claim = claimBoundOAuthFlow({ flowId, provider, kind: "device" });

  let pending = false;
  try {
    const resolvedProxy = await resolveOAuthProxySelection(claim.payload.proxySelection);
    const { deviceCode, codeVerifier, extraData } = claim.payload;
    if (!deviceCode) {
      throw oauthRouteError(
        "OAUTH_VALIDATION_FAILED",
        "OAuth device session is invalid",
      );
    }

    let result;
    if (NO_PKCE_POLL_PROVIDERS.has(provider)) {
      result = await callOAuthUpstream(() =>
        pollForToken(provider, deviceCode, null, null, resolvedProxy.proxyOptions));
    } else if (provider === "kiro") {
      result = await callOAuthUpstream(() =>
        pollForToken(provider, deviceCode, null, extraData, resolvedProxy.proxyOptions));
    } else if (provider === "qoder") {
      if (!codeVerifier) {
        throw oauthRouteError(
          "OAUTH_VALIDATION_FAILED",
          "OAuth device session is missing its verifier",
        );
      }
      result = await callOAuthUpstream(() =>
        pollForToken(provider, deviceCode, codeVerifier, extraData, resolvedProxy.proxyOptions));
    } else {
      if (!codeVerifier) {
        throw oauthRouteError(
          "OAUTH_VALIDATION_FAILED",
          "OAuth device session is missing its verifier",
        );
      }
      result = await callOAuthUpstream(() =>
        pollForToken(provider, deviceCode, codeVerifier, null, resolvedProxy.proxyOptions));
    }

    if (result.success) {
      const connection = await saveOAuthConnection(
        provider,
        result.tokens,
        resolvedProxy,
        {},
        claim,
      );
      return { success: true, connection: publicConnection(connection, false) };
    }

    pending = Boolean(
      result.pending ||
      result.error === "authorization_pending" ||
      result.error === "slow_down",
    );
    return {
      success: false,
      error: result.error,
      errorDescription: sanitizeErrorMessage(result.errorDescription || result.error || "Authorization pending"),
      pending,
    };
  } catch (error) {
    throw normalizeOAuthCompletionError(error);
  } finally {
    settleOAuthFlowClaim(claim, { pending });
  }
}

async function startFixedPortProxy(provider, input) {
  if (!["codex", "xai"].includes(provider)) {
    throw oauthRouteError(
      "OAUTH_VALIDATION_FAILED",
      "Proxy only supported for codex/xai",
    );
  }
  const appPort = Number(input.appPort ?? input.app_port);
  if (!Number.isInteger(appPort) || appPort < 1 || appPort > 65535) {
    throw oauthRouteError("OAUTH_VALIDATION_FAILED", "Missing or invalid app port");
  }

  return withFixedProxyOperation(provider, async () => {
    const selector = {
      flowId: typeof input.flowId === "string" ? input.flowId.trim() : undefined,
      state: typeof input.state === "string" ? input.state.trim() : undefined,
      provider,
    };
    let flow = getOAuthFlow(selector);
    if (!flow && selector.flowId) {
      const flowById = getOAuthFlow({ flowId: selector.flowId, provider });
      if (flowById && selector.state && flowById.state !== selector.state) {
        throw oauthRouteError("OAUTH_STATE_MISMATCH", "OAuth state did not match this flow");
      }
    }
    if (!flow || flow.kind !== "authorization" || !flow.state) {
      throw oauthRouteError(
        flow && flow.kind !== "authorization"
          ? "OAUTH_VALIDATION_FAILED"
          : "OAUTH_SESSION_GONE",
        flow && flow.kind !== "authorization"
          ? "OAuth flow type did not match this operation"
          : "OAuth session expired or was cancelled",
      );
    }

    const stop = provider === "xai" ? stopXaiProxy : stopCodexProxy;
    const start = provider === "xai" ? startXaiProxy : startCodexProxy;
    const register = provider === "xai" ? registerXaiSession : registerCodexSession;
    await stop();
    flow = getOAuthFlow(selector);
    if (!flow || flow.kind !== "authorization") {
      throw oauthRouteError(
        "OAUTH_SESSION_GONE",
        "OAuth session was superseded before callback server startup",
      );
    }
    const result = await start(appPort);
    if (!result.success && result.reason === "port_busy") {
      throw oauthRouteError(
        "OAUTH_FLOW_CONFLICT",
        "OAuth callback port is already in use",
      );
    }
    const serverSide = result.success
      ? register({ state: flow.state, flowId: flow.flowId })
      : false;
    if (result.success && !serverSide) await stop();
    return { ...result, serverSide, state: flow.state, flowId: flow.flowId };
  });
}

async function fixedPortStatus(provider, input) {
  if (!["codex", "xai"].includes(provider)) {
    throw oauthRouteError(
      "OAUTH_VALIDATION_FAILED",
      "Poll only supported for codex/xai",
    );
  }
  const requestedFlowId = typeof input.flowId === "string" ? input.flowId.trim() : "";
  if (!requestedFlowId) {
    throw oauthRouteError("OAUTH_VALIDATION_FAILED", "Missing OAuth flow ID");
  }
  const flow = getOAuthFlow({
    flowId: requestedFlowId,
    state: typeof input.state === "string" ? input.state.trim() : undefined,
    provider,
  });
  if (!flow) {
    const flowById = getOAuthFlow({ flowId: requestedFlowId, provider });
    const requestedState = typeof input.state === "string" ? input.state.trim() : "";
    if (flowById && requestedState && flowById.state !== requestedState) {
      throw oauthRouteError("OAUTH_STATE_MISMATCH", "OAuth state did not match this flow");
    }
  }
  const state = flow?.state || (typeof input.state === "string" ? input.state.trim() : "");
  if (!state) {
    throw oauthRouteError("OAUTH_VALIDATION_FAILED", "Missing OAuth state");
  }
  const status = provider === "xai" ? getXaiSessionStatus(state) : getCodexSessionStatus(state);
  if (!status || status.flowId !== requestedFlowId) return { status: "unknown" };
  const response = {
    status: status.status,
    ...(status.connectionId ? { connectionId: status.connectionId } : {}),
    ...(status.email ? { email: status.email } : {}),
    ...(status.error ? { error: sanitizeErrorMessage(status.error) } : {}),
  };
  if (status.status === "done" || status.status === "error") {
    if (provider === "xai") clearXaiSession(state);
    else clearCodexSession(state);
  }
  return response;
}

async function stopFixedPortProxy(provider, input) {
  if (!["codex", "xai"].includes(provider)) {
    throw oauthRouteError(
      "OAUTH_VALIDATION_FAILED",
      "Proxy only supported for codex/xai",
    );
  }
  return withFixedProxyOperation(provider, async () => {
    const selector = {
      flowId: typeof input.flowId === "string" ? input.flowId.trim() : undefined,
      state: typeof input.state === "string" ? input.state.trim() : undefined,
      provider,
    };
    const flow = getOAuthFlow(selector);
    const state = flow?.state || selector.state;
    const session = state
      ? (provider === "xai" ? getXaiSessionStatus(state) : getCodexSessionStatus(state))
      : null;
    const ownsSession = Boolean(selector.flowId && session?.flowId === selector.flowId);
    if (!ownsSession) return { success: true, stopped: false };
    if (flow) cancelOAuthFlow({ flowId: flow.flowId, provider });
    if (state) {
      if (provider === "xai") clearXaiSession(state);
      else clearCodexSession(state);
    }
    if (provider === "xai") await stopXaiProxy();
    else await stopCodexProxy();
    return { success: true, stopped: true };
  });
}

function cancelServerOAuthFlow(provider, input) {
  const flowId = typeof input.flowId === "string" ? input.flowId.trim() : "";
  const state = typeof input.state === "string" ? input.state.trim() : undefined;
  if (!flowId) return { success: true, cancelled: false };
  const flow = getOAuthFlow({ flowId, state, provider });
  return {
    success: true,
    cancelled: flow ? cancelOAuthFlow({ flowId, state, provider }) : false,
  };
}

async function completeXaiManualCode(input) {
  const code = typeof input.code === "string" ? input.code.trim() : "";
  const state = typeof input.state === "string" ? input.state.trim() : "";
  const flowId = typeof input.flowId === "string" ? input.flowId.trim() : "";
  if (!code || !state || !flowId) {
    throw oauthRouteError("OAUTH_VALIDATION_FAILED", "Missing required fields");
  }
  const session = state ? getXaiSessionStatus(state) : null;
  if (session?.flowId !== flowId) {
    throw oauthRouteError(
      "OAUTH_SESSION_GONE",
      "xAI OAuth session not found; restart the login flow and paste the code again",
    );
  }
  const claim = claimBoundOAuthFlow({
    flowId,
    state,
    provider: "xai",
    kind: "authorization",
  });
  try {
    const { connection } = await exchangeAndSaveAuthorizationCode("xai", code, state, claim);
    return connection;
  } catch (error) {
    throw normalizeOAuthCompletionError(error);
  } finally {
    consumeOAuthFlow(claim);
    // A new manual attempt may register while the old exchange is in flight.
    // Only the session still owned by this flow may clear and stop the shared
    // fixed-port listener.
    if (getXaiSessionStatus(state)?.flowId === flowId) {
      clearXaiSession(state);
      await stopXaiProxy();
    }
  }
}

async function importToken(provider, body) {
  const providerData = requireOAuthProvider(provider);
  if (providerData.flowType !== "import_token" || typeof providerData.mapTokens !== "function") {
    throw oauthRouteError(
      "OAUTH_VALIDATION_FAILED",
      `Provider ${provider} does not support import-token`,
    );
  }
  const rawToken = body.accessToken ?? body.token ?? body.authJson ?? body;
  let tokenData;
  try {
    tokenData = providerData.mapTokens(rawToken);
  } catch (error) {
    throw oauthRouteError("OAUTH_VALIDATION_FAILED", "Invalid token payload", error);
  }
  if (!tokenData?.accessToken) {
    throw oauthRouteError("OAUTH_VALIDATION_FAILED", "Missing accessToken");
  }
  return createProviderConnection({
    provider,
    authType: "oauth",
    ...tokenData,
    expiresAt: tokenData.expiresIn
      ? new Date(Date.now() + tokenData.expiresIn * 1000).toISOString()
      : null,
    testStatus: "active",
  });
}

/** GET compatibility surface; the dashboard uses POST so secrets stay out of URLs. */
export async function GET(request, { params }) {
  let operation = "GET";
  try {
    await ensureOutboundProxyInitialized();
    const { provider, action } = await params;
    operation = `${provider}/${action}`;
    const { searchParams } = new URL(request.url);

    if (action === "authorize") {
      const reserved = new Set(["redirect_uri", "proxyMode", "proxyPoolId", "ownerId"]);
      const meta = {};
      searchParams.forEach((value, key) => {
        if (!reserved.has(key) && !SAFE_GET_META_KEYS.has(key)) {
          throw oauthRouteError(
            "OAUTH_VALIDATION_FAILED",
            "OAuth metadata must be submitted in a POST body",
          );
        }
        if (!reserved.has(key)) meta[key] = value;
      });
      return NextResponse.json(await beginAuthorization(provider, {
        redirectUri: searchParams.get("redirect_uri"),
        ownerId: searchParams.get("ownerId"),
        ...searchProxySelection(searchParams),
        ...(Object.keys(meta).length ? { meta } : {}),
      }));
    }
    if (action === "device-code") {
      return NextResponse.json(await beginDeviceCode(provider, {
        ...searchProxySelection(searchParams),
        ownerId: searchParams.get("ownerId"),
        startUrl: searchParams.get("start_url"),
        region: searchParams.get("region"),
        authMethod: searchParams.get("auth_method"),
      }));
    }
    if (action === "start-proxy") {
      return NextResponse.json(await startFixedPortProxy(provider, {
        appPort: searchParams.get("app_port"),
        flowId: searchParams.get("flowId"),
        state: searchParams.get("state"),
      }));
    }
    if (action === "poll-status") {
      return NextResponse.json(await fixedPortStatus(provider, {
        flowId: searchParams.get("flowId"),
        state: searchParams.get("state"),
      }));
    }
    if (action === "stop-proxy") {
      return NextResponse.json(await stopFixedPortProxy(provider, {
        flowId: searchParams.get("flowId"),
        state: searchParams.get("state"),
      }));
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return oauthErrorResponse(error, operation);
  }
}

/** POST surface for server-bound authorization and device-code flows. */
export async function POST(request, { params }) {
  let operation = "POST";
  try {
    await ensureOutboundProxyInitialized();
    const { provider, action } = await params;
    operation = `${provider}/${action}`;
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid or empty request body" }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    if (action === "authorize") {
      return NextResponse.json(await beginAuthorization(provider, body));
    }
    if (action === "device-code") {
      return NextResponse.json(await beginDeviceCode(provider, body));
    }
    if (action === "start-proxy") {
      return NextResponse.json(await startFixedPortProxy(provider, body));
    }
    if (action === "poll-status") {
      return NextResponse.json(await fixedPortStatus(provider, body));
    }
    if (action === "stop-proxy") {
      return NextResponse.json(await stopFixedPortProxy(provider, body));
    }
    if (action === "cancel") {
      return NextResponse.json(cancelServerOAuthFlow(provider, body));
    }
    if (action === "import-token") {
      const connection = await importToken(provider, body);
      return NextResponse.json({ success: true, connection: publicConnection(connection) });
    }
    if (action === "exchange") {
      const connection = await completeAuthorization(provider, body);
      return NextResponse.json({ success: true, connection: publicConnection(connection) });
    }
    if (action === "poll") {
      return NextResponse.json(await pollDeviceCode(provider, body));
    }
    if (action === "manual-code") {
      if (provider !== "xai") {
        return NextResponse.json({ error: "Manual code only supported for xai" }, { status: 400 });
      }
      const connection = await completeXaiManualCode(body);
      return NextResponse.json({ success: true, connection: publicConnection(connection) });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return oauthErrorResponse(error, operation);
  }
}

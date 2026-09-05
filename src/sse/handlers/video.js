import { withRequestCorrelation } from "../utils/requestCorrelation.js";
import { getProviderCredentialsWithQuotaPreflight, markAccountUnavailable, clearAccountError, resolveClientApiKey } from "../services/auth.js";
import { getSettings, getProviderConnectionById, getApiKeyProviderConnectionIds } from "@/lib/localDb";
import { getModelInfo } from "../services/model.js";
import { handleVideoGenerationCore } from "open-sse/handlers/videoGenerationCore.js";
import { handleVideoProxyCore, getVideoConfig, sanitizeSecrets, VIDEO_ACTIONS } from "open-sse/handlers/videoCore.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { enforceApiKeyModelPolicy, recordApiKeyUsageForResponse } from "../services/apiKeyPolicy.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import * as log from "../utils/logger.js";

// Async video jobs (xAI Grok Imagine shape) are xAI-only today; requests
// without a provider prefix (bare model id, or multipart bodies we
// deliberately don't parse) land here.
const DEFAULT_VIDEO_PROVIDER = "xai";

async function enforceVideoPolicy(request, provider, model, apiKey) {
  return enforceApiKeyModelPolicy(request, `${provider}/${model}`, apiKey);
}

function shouldMarkAccountUnavailable(status) {
  const code = Number(status);
  return code >= HTTP_STATUS.SERVER_ERROR
    || [HTTP_STATUS.UNAUTHORIZED, HTTP_STATUS.PAYMENT_REQUIRED, HTTP_STATUS.FORBIDDEN, HTTP_STATUS.RATE_LIMITED].includes(code);
}

async function handleVideoGenerationHandler(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const settings = await getSettings();
  const { apiKey, auth: apiKeyAuth } = await resolveClientApiKey(request, {
    required: settings.requireApiKey === true,
  });
  if (!apiKeyAuth.ok) return errorResponse(
    HTTP_STATUS.UNAUTHORIZED,
    apiKeyAuth.reason === "missing" ? "Missing API key" : "Invalid API key",
  );

  if (!body.model) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  const modelInfo = await getModelInfo(body.model);
  if (!modelInfo.provider) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  const policyError = await enforceVideoPolicy(request, modelInfo.provider, modelInfo.model, apiKey);
  if (policyError) return policyError;
  const credentials = await getProviderCredentialsWithQuotaPreflight(modelInfo.provider, null, modelInfo.model, { apiKeyId: apiKeyAuth.apiKeyId });
  if (credentials?.providerDisabled) {
    log.warn("VIDEO", `[${modelInfo.provider}/${modelInfo.model}] free no-auth provider disabled by settings`);
    return errorResponse(HTTP_STATUS.FORBIDDEN, `Provider '${modelInfo.provider}' is disabled. Enable it in Settings > Providers.`);
  }
  if (credentials?.allRateLimited) {
    const status = Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
    const message = credentials.lastError || `All accounts unavailable for provider: ${modelInfo.provider}`;
    return unavailableResponse(status, message, credentials.retryAfter, credentials.retryAfterHuman);
  }
  if (!credentials) return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${modelInfo.provider}`);

  const result = await handleVideoGenerationCore({ provider: modelInfo.provider, model: modelInfo.model, body, credentials, signal: request.signal });
  if (!result.success) return result.response;
  return recordApiKeyUsageForResponse(apiKey, result.response, {
    tokens: String(body.prompt || "").length / 4,
    cost: 0,
  });
}

/**
 * Read the request body once, byte-preserving.
 * JSON bodies are additionally parsed so the `model` provider prefix can be
 * resolved (and stripped) — everything else is forwarded exactly as received.
 */
async function readForwardableBody(request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const raw = await request.text();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { error: errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body") };
    }
    return { raw, parsed, contentType };
  }
  // Multipart (or any other content type): forward the exact bytes — parsing
  // and re-encoding FormData would change the multipart boundary.
  const buf = Buffer.from(await request.arrayBuffer());
  return { raw: buf, parsed: null, contentType };
}

async function resolveVideoProvider(parsedBody) {
  if (!parsedBody?.model) return { provider: DEFAULT_VIDEO_PROVIDER, model: null };

  const modelStr = String(parsedBody.model);
  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) {
    return { error: errorResponse(HTTP_STATUS.BAD_REQUEST, "Combos are not supported for video generation") };
  }
  if (!getVideoConfig(modelInfo.provider)) {
    // Bare model ids (no explicit "provider/" prefix) fall back to the default
    // video provider — the prefix-less inference targets chat providers only.
    if (!modelStr.includes("/")) {
      return { provider: DEFAULT_VIDEO_PROVIDER, model: modelStr };
    }
    return { error: errorResponse(HTTP_STATUS.BAD_REQUEST, `Provider '${modelInfo.provider}' does not support video generation`) };
  }
  return { provider: modelInfo.provider, model: modelInfo.model };
}

function withConnectionHeader(response, connectionId) {
  if (!connectionId) return response;
  const headers = new Headers(response.headers);
  // Video jobs are account-bound upstream — clients echo this back as
  // `x-connection-id` on GET polls so the same account is used.
  headers.set("x-9router-connection-id", String(connectionId));
  // Allow clients to read the account-pinning header from CORS responses.
  const exposed = headers.get("Access-Control-Expose-Headers") || "";
  const exposedList = exposed.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  headers.set(
    "Access-Control-Expose-Headers",
    exposedList.includes("x-9router-connection-id")
      ? exposed
      : exposed ? `${exposed}, x-9router-connection-id` : "x-9router-connection-id",
  );
  return new Response(response.body, { status: response.status, headers });
}

/**
 * POST /v1/videos/{generations|edits|extensions} — async job creation proxy.
 *
 * Creation POSTs are billable upstream jobs, so there is NO account-rotation
 * loop here: one credential is selected (honoring a preferred `x-connection-id`)
 * and the upstream result is returned. A network error or 5xx is surfaced as-is
 * rather than re-sent, because the job may already exist upstream.
 * Ported from decolua/9router#2593, adapted to fork auth (`resolveClientApiKey`
 * + `enforceApiKeyModelPolicy`) and single-credential dispatch.
 */
async function handleVideoCreateHandler(request, action) {
  if (!VIDEO_ACTIONS.has(action)) {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, `Unknown video action: ${action}`);
  }

  const settings = await getSettings();
  const { apiKey, auth: apiKeyAuth } = await resolveClientApiKey(request, {
    required: settings.requireApiKey === true,
  });
  if (!apiKeyAuth.ok) return errorResponse(
    HTTP_STATUS.UNAUTHORIZED,
    apiKeyAuth.reason === "missing" ? "Missing API key" : "Invalid API key",
  );

  const bodyInfo = await readForwardableBody(request);
  if (bodyInfo.error) return bodyInfo.error;

  const resolved = await resolveVideoProvider(bodyInfo.parsed);
  if (resolved.error) return resolved.error;
  const { provider, model } = resolved;

  // Policy needs a concrete model; bodies that omit `model` (allowed by the
  // upstream xAI video API) default to the provider's video model.
  const policyError = await enforceVideoPolicy(request, provider, model || "grok-imagine-video", apiKey);
  if (policyError) return policyError;

  // Strip the provider prefix (e.g. "xai/grok-imagine-video") before forwarding;
  // otherwise forward the original bytes untouched.
  let forwardBody = bodyInfo.raw;
  if (bodyInfo.parsed && model && bodyInfo.parsed.model !== model) {
    forwardBody = JSON.stringify({ ...bodyInfo.parsed, model });
  }

  const preferredConnectionId = request.headers.get("x-connection-id") || null;
  const idempotencyKey = request.headers.get("idempotency-key") || null;

  const credentials = await getProviderCredentialsWithQuotaPreflight(provider, null, model, { preferredConnectionId, apiKeyId: apiKeyAuth.apiKeyId });
  if (!credentials || credentials.allRateLimited || credentials.providerDisabled) {
    if (credentials?.providerDisabled) {
      log.warn("VIDEO", `[${provider}/${model || "grok-imagine-video"}] free no-auth provider disabled by settings`);
      return errorResponse(HTTP_STATUS.FORBIDDEN, `Provider '${provider}' is disabled. Enable it in Settings > Providers.`);
    }
    if (credentials?.allRateLimited) {
      return unavailableResponse(
        Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE,
        `[${provider}/${model || "grok-imagine-video"}] ${credentials.lastError || "Unavailable"}`,
        credentials.retryAfter,
        credentials.retryAfterHuman,
      );
    }
    return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
  }

  const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

  const result = await handleVideoProxyCore({
    provider,
    action,
    rawBody: forwardBody,
    contentType: bodyInfo.contentType || null,
    idempotencyKey,
    credentials: refreshedCredentials,
    signal: request.signal,
    log,
    onCredentialsRefreshed: async (newCreds) => {
      await updateProviderCredentials(credentials.connectionId, {
        accessToken: newCreds.accessToken,
        refreshToken: newCreds.refreshToken,
        providerSpecificData: newCreds.providerSpecificData,
        testStatus: "active",
      });
    },
  });

  if (result.success) {
    await clearAccountError(credentials.connectionId, credentials, model);
    log.info("VIDEO", `${provider.toUpperCase()} | ${action} accepted (connection ${credentials.connectionId})`);
    return recordApiKeyUsageForResponse(apiKey, withConnectionHeader(result.response, credentials.connectionId), {
      tokens: String(bodyInfo.parsed?.prompt || "").length / 4,
      cost: 0,
    });
  }

  // Record the failure (dashboard shows lastError/errorCode → user sees re-auth is needed)
  if (shouldMarkAccountUnavailable(result.status)) {
    await markAccountUnavailable(
      credentials.connectionId, result.status, sanitizeSecrets(result.error, refreshedCredentials), provider, model
    );
  }
  return result.response;
}

/**
 * GET /v1/videos/{request_id} — poll job status.
 * Jobs are account-bound upstream, so no cross-account rotation here: the
 * caller pins the creating account via `x-connection-id` (returned on create).
 */
async function handleVideoGetHandler(request, requestId) {
  const settings = await getSettings();
  const { apiKey, auth: apiKeyAuth } = await resolveClientApiKey(request, {
    required: settings.requireApiKey === true,
  });
  if (!apiKeyAuth.ok) return errorResponse(
    HTTP_STATUS.UNAUTHORIZED,
    apiKeyAuth.reason === "missing" ? "Missing API key" : "Invalid API key",
  );

  if (!requestId) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing video request id");

  const preferredConnectionId = request.headers.get("x-9router-connection-id") || request.headers.get("x-connection-id") || null;
  let provider = DEFAULT_VIDEO_PROVIDER;
  if (preferredConnectionId) {
    const scopedConnectionIds = apiKeyAuth.apiKeyId ? await getApiKeyProviderConnectionIds(apiKeyAuth.apiKeyId) : [];
    if (scopedConnectionIds.length > 0 && !scopedConnectionIds.includes(preferredConnectionId)) {
      return errorResponse(HTTP_STATUS.BAD_REQUEST, "Requested connection is not available for this API key");
    }
    const pinnedConnection = await getProviderConnectionById(preferredConnectionId);
    if (pinnedConnection?.provider && getVideoConfig(pinnedConnection.provider)) provider = pinnedConnection.provider;
  }
  const policyModel = getVideoConfig(provider)?.defaultModel || "grok-imagine-video";
  const policyError = await enforceVideoPolicy(request, provider, policyModel, apiKey);
  if (policyError) return policyError;

  const credentials = await getProviderCredentialsWithQuotaPreflight(provider, null, null, { preferredConnectionId, apiKeyId: apiKeyAuth.apiKeyId });
  if (!credentials || credentials.allRateLimited || credentials.providerDisabled) {
    if (credentials?.providerDisabled) {
      log.warn("VIDEO", `[${provider}/${policyModel}] free no-auth provider disabled by settings`);
      return errorResponse(HTTP_STATUS.FORBIDDEN, `Provider '${provider}' is disabled. Enable it in Settings > Providers.`);
    }
    if (credentials?.allRateLimited) {
      return unavailableResponse(
        Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE,
        `[${provider}/${policyModel}] ${credentials.lastError || "Unavailable"}`,
        credentials.retryAfter,
        credentials.retryAfterHuman,
      );
    }
    return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
  }

  const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

  const result = await handleVideoProxyCore({
    provider,
    requestId,
    credentials: refreshedCredentials,
    signal: request.signal,
    log,
    onCredentialsRefreshed: async (newCreds) => {
      await updateProviderCredentials(credentials.connectionId, {
        accessToken: newCreds.accessToken,
        refreshToken: newCreds.refreshToken,
        providerSpecificData: newCreds.providerSpecificData,
        testStatus: "active",
      });
    },
  });

  if (result.success) {
    await clearAccountError(credentials.connectionId, credentials, null);
    return withConnectionHeader(result.response, credentials.connectionId);
  }

  if (shouldMarkAccountUnavailable(result.status)) {
    await markAccountUnavailable(
      credentials.connectionId, result.status, sanitizeSecrets(result.error, refreshedCredentials), provider, null
    );
  }
  return result.response;
}
export const handleVideoGeneration = withRequestCorrelation(handleVideoGenerationHandler);
export const handleVideoCreate = withRequestCorrelation(handleVideoCreateHandler);
export const handleVideoGet = withRequestCorrelation(handleVideoGetHandler);

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
import { isString } from "@/shared/utils/typeChecks.js";
import { handleComboChat } from "open-sse/services/combo.js";
import { supportsVideoGeneration } from "open-sse/handlers/videoGenerationCore.js";
import {
  wantsDefaultRoute,
  resolveMediaRoute,
  defaultRouteComboOptions,
  listMediaRouteCandidates,
  providerOfModelId,
  supportsVideoJobs
} from "../services/mediaRoutes.js";


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

  if (wantsDefaultRoute(body.model)) {
    const route = await resolveMediaRoute("video", { settings, supports: supportsVideoGeneration, apiKeyId: apiKeyAuth.apiKeyId });
    if (route.error) return route.error;
    return handleComboChat({
      body,
      models: route.models,
      handleSingleModel: (b, m) => handleSingleModelVideo(b, m, request, apiKey, apiKeyAuth.apiKeyId),
      log,
      ...defaultRouteComboOptions("video")
    });
  }
  return handleSingleModelVideo(body, body.model, request, apiKey, apiKeyAuth.apiKeyId);
}

async function handleSingleModelVideo(body, modelStr, request, apiKey, apiKeyId) {
  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  const policyError = await enforceVideoPolicy(request, modelInfo.provider, modelInfo.model, apiKey);
  if (policyError) return policyError;
  const credentials = await getProviderCredentialsWithQuotaPreflight(modelInfo.provider, null, modelInfo.model, { apiKeyId });
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
  // and re-encoding FormData would change the multipart boundary. A copy is
  // parsed only to read the `model` field that picks the provider.
  const buf = Buffer.from(await request.arrayBuffer());
  let formModel = null;
  if (contentType.includes("multipart/form-data")) {
    try {
      const value = (await new Response(buf, { headers: { "content-type": contentType } }).formData()).get("model");
      formModel = isString(value) ? value : null;
    } catch {
      return { error: errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid multipart body") };
    }
  }
  return { raw: buf, parsed: null, contentType, formModel };
}

/**
 * Re-encode a multipart body with `model` set to the provider-local id. Only
 * used when the client sent a `provider/model` field; the new boundary comes
 * back in the content type.
 */
async function withMultipartModel(raw, contentType, model) {
  const form = await new Response(raw, { headers: { "content-type": contentType } }).formData();
  form.set("model", model);
  const encoded = new Request("http://localhost/", { method: "POST", body: form });
  return { body: Buffer.from(await encoded.arrayBuffer()), contentType: encoded.headers.get("content-type") };
}

/**
 * No model (or a multipart body, which is forwarded unparsed): the video
 * route's first model whose provider runs async jobs. Creation is a billable
 * upstream job, so it is never retried on a second model.
 */
async function resolveRoutedVideoModel(settings, apiKeyId) {
  const route = await resolveMediaRoute("video", { settings, supports: supportsVideoJobs, apiKeyId });
  if (route.error) return { error: route.error };
  const modelInfo = await getModelInfo(route.models[0]);
  return { provider: modelInfo.provider, model: modelInfo.model };
}

async function resolveVideoProvider(requestedModel, settings, apiKeyId) {
  if (wantsDefaultRoute(requestedModel)) return resolveRoutedVideoModel(settings, apiKeyId);

  const modelStr = String(requestedModel);
  // Bare model ids (no "provider/" prefix): prefix-less inference targets chat
  // providers, so match the id exactly against the connected video models
  // first. Two providers serving the same id is ambiguous.
  if (!modelStr.includes("/")) {
    const providers = [...new Set((await listMediaRouteCandidates("video", { apiKeyId }))
      .map((m) => m.id)
      .filter((id) => id.slice(id.indexOf("/") + 1) === modelStr)
      .map(providerOfModelId)
      .filter(supportsVideoJobs))];
    if (providers.length === 1) return { provider: providers[0], model: modelStr };
    if (providers.length > 1) {
      return { error: errorResponse(HTTP_STATUS.BAD_REQUEST, `Model '${modelStr}' is served by ${providers.join(", ")}; use a provider/model id`) };
    }
  }

  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) {
    return { error: errorResponse(HTTP_STATUS.BAD_REQUEST, "Combos are not supported for video generation") };
  }
  if (!getVideoConfig(modelInfo.provider)) {
    const message = modelStr.includes("/")
      ? `Provider '${modelInfo.provider}' does not support video generation`
      : `No connected video provider serves model '${modelStr}'`;
    return { error: errorResponse(HTTP_STATUS.BAD_REQUEST, message) };
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

  const requestedModel = bodyInfo.parsed ? bodyInfo.parsed.model : bodyInfo.formModel;
  const resolved = await resolveVideoProvider(requestedModel, settings, apiKeyAuth.apiKeyId);
  if (resolved.error) return resolved.error;
  const { provider, model } = resolved;

  const policyError = await enforceVideoPolicy(request, provider, model, apiKey);
  if (policyError) return policyError;

  // Strip the provider prefix (e.g. "xai/grok-imagine-video") before forwarding;
  // otherwise forward the original bytes untouched.
  let forwardBody = bodyInfo.raw;
  let forwardContentType = bodyInfo.contentType || null;
  if (bodyInfo.parsed && model && bodyInfo.parsed.model !== model) {
    forwardBody = JSON.stringify({ ...bodyInfo.parsed, model });
  } else if ((bodyInfo.contentType || "").includes("multipart/form-data") && model && bodyInfo.formModel !== model) {
    // A prefixed, missing, or blank multipart model: send the provider-local
    // id, like a JSON body, so upstream runs the model the gateway chose.
    ({ body: forwardBody, contentType: forwardContentType } = await withMultipartModel(bodyInfo.raw, bodyInfo.contentType, model));
  }

  const preferredConnectionId = request.headers.get("x-connection-id") || null;
  const idempotencyKey = request.headers.get("idempotency-key") || null;

  const credentials = await getProviderCredentialsWithQuotaPreflight(provider, null, model, { preferredConnectionId, apiKeyId: apiKeyAuth.apiKeyId });
  if (!credentials || credentials.allRateLimited || credentials.providerDisabled) {
    if (credentials?.providerDisabled) {
      log.warn("VIDEO", `[${provider}/${model}] free no-auth provider disabled by settings`);
      return errorResponse(HTTP_STATUS.FORBIDDEN, `Provider '${provider}' is disabled. Enable it in Settings > Providers.`);
    }
    if (credentials?.allRateLimited) {
      return unavailableResponse(
        Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE,
        `[${provider}/${model}] ${credentials.lastError || "Unavailable"}`,
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
    contentType: forwardContentType,
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
      credentials.connectionId, result.status, sanitizeSecrets(result.error, refreshedCredentials), provider, model, null, {
        // The credential this attempt actually presented, so a durable-key
        // provider can mark exactly the generation that was rejected.
        usedCredential: refreshedCredentials.accessToken || refreshedCredentials.apiKey || null
      }
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
  let provider = null;
  if (preferredConnectionId) {
    const scopedConnectionIds = apiKeyAuth.apiKeyId ? await getApiKeyProviderConnectionIds(apiKeyAuth.apiKeyId) : [];
    if (scopedConnectionIds.length > 0 && !scopedConnectionIds.includes(preferredConnectionId)) {
      return errorResponse(HTTP_STATUS.BAD_REQUEST, "Requested connection is not available for this API key");
    }
    const pinnedConnection = await getProviderConnectionById(preferredConnectionId);
    if (pinnedConnection?.provider && getVideoConfig(pinnedConnection.provider)) provider = pinnedConnection.provider;
  }
  // Jobs are account-bound, so an unpinned poll is only safe to guess when a
  // single async video provider is connected; otherwise the client must echo
  // the create response's connection header.
  if (!provider) {
    const jobProviders = [...new Set((await listMediaRouteCandidates("video", { apiKeyId: apiKeyAuth.apiKeyId }))
      .map((m) => providerOfModelId(m.id))
      .filter(supportsVideoJobs))];
    if (jobProviders.length !== 1) {
      return errorResponse(
        HTTP_STATUS.BAD_REQUEST,
        "Missing x-connection-id: echo the x-9router-connection-id header from the create response"
      );
    }
    provider = jobProviders[0];
  }
  const policyModel = getVideoConfig(provider)?.defaultModel || "grok-imagine-video";
  const policyError = await enforceVideoPolicy(request, provider, policyModel, apiKey);
  if (policyError) return policyError;

  // Polls carry no model, and `model = null` resolves to the account-wide lock
  // key, so a poll failure would otherwise cool down the whole account for
  // chat and every other modality. Scope poll cooldowns to their own key, and
  // never substitute another account for a job that only exists on this one.
  const credentials = await getProviderCredentialsWithQuotaPreflight(provider, null, null, {
    preferredConnectionId,
    strictConnectionId: preferredConnectionId,
    apiKeyId: apiKeyAuth.apiKeyId,
    videoPoll: true,
  });
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
    await clearAccountError(credentials.connectionId, credentials, null, { videoPoll: true });
    return withConnectionHeader(result.response, credentials.connectionId);
  }

  if (shouldMarkAccountUnavailable(result.status)) {
    await markAccountUnavailable(
      credentials.connectionId, result.status, sanitizeSecrets(result.error, refreshedCredentials), provider, null, null, {
        videoPoll: true,
        usedCredential: refreshedCredentials.accessToken || refreshedCredentials.apiKey || null
      }
    );
  }
  return result.response;
}
export const handleVideoGeneration = withRequestCorrelation(handleVideoGenerationHandler);
export const handleVideoCreate = withRequestCorrelation(handleVideoCreateHandler);
export const handleVideoGet = withRequestCorrelation(handleVideoGetHandler);

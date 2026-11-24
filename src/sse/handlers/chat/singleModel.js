import { getProviderCredentialsWithQuotaPreflight, projectProviderCredentials, markAccountUnavailable, clearAccountError } from "../../services/auth.js";
import { credentialDispatchSnapshot } from "@/shared/utils/credentialFingerprint.js";
import { antigravityHealth, healthEnabled, trackHealthResponse } from "open-sse/services/antigravityHealth.js";
import { withRouteResponseHeaders } from "open-sse/utils/routeResponseHeaders.js";
import { runWithConnectionRecovery } from "@/lib/routing/connectionRecovery.js";
import { resolveFallbackModelScope } from "open-sse/services/fallbackScope.js";
import { isChatProvider, isNativeOnlyModel } from "open-sse/providers/chatCapability.js";
import { KIMI_CODING_MODELS_URL } from "../../../../open-sse/providers/shared.js";
import { getSettings, getProviderConnections, updateProviderConnection, getApiKeyProviderConnectionIds } from "@/lib/localDb";
import { getTransform as getPxpipeTransform } from "@/lib/pxpipe/loader.js";
import { appendHeadroomEvent } from "@/lib/headroom/events.js";
import { appendPxpipeEvent } from "@/lib/pxpipe/events.js";
import { getModelInfo, loadCustomCapabilities, parseModel } from "../../services/model.js";
import { recordTokenSaverEvent } from "@/lib/usageDb";
import { applyVisionBridgeReroute } from "open-sse/services/model.js";
import { resolveChatgptPlanDispatch } from "../../services/chatgptPlanDispatch.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { enforceCursorCapabilities, getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { parseSuffix } from "open-sse/translator/concerns/thinkingSuffix.js";
import { warmLiveModelLimits } from "open-sse/services/liveModelLimits.js";
import { DEFAULT_HEADROOM_URL } from "@/lib/headroom/detect";
import { errorResponse, unavailableResponse, getClientStatusFromError } from "open-sse/utils/error.js";
import { validateProviderRequestId } from "../../utils/requestCorrelation.js";
import { isLocalStreamLifecycleError, isRequestScopedStreamError } from "open-sse/utils/streamLifecycle.js";
import { peekStreamForContent } from "open-sse/utils/streamContentPeek.js";
import { isRoutableProvider } from "../../../shared/constants/providers.js";
import { getFusionRequiredInput, comboPolicyRejection } from "open-sse/services/combo.js";
import { notifyWebhookEvent } from "@/lib/webhooks/index.js";
import { HTTP_STATUS, STREAM_EARLY_EOF_PEEK_MS } from "open-sse/config/runtimeConfig.js";
import { EMPTY_CONTENT_COOLDOWN_MS } from "open-sse/config/errorConfig.js";
import { detectFormatByEndpoint } from "open-sse/translator/formats.js";
import { isAntigravityCapacityError, isRequestReplayBufferError, isDurableCredentialProvider } from "open-sse/services/accountFallback.js";
import { resolveClientSessionId } from "open-sse/utils/sessionManager.js";
import * as log from "../../utils/logger.js";
import { updateProviderCredentials } from "../../services/tokenRefresh.js";
import { refreshAndUpdateCredentials } from "@/shared/services/providerCredentials";
import { providerRefreshContext } from "@/shared/utils/providerCredentialContext";
import { allocateProviderAttemptTimestamp } from "@/shared/services/providerRateLimitEvidence";
import { getModelQuotaFamily, getDispatchUpstreamModelId, PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";
import { resolveProviderId } from "@/shared/constants/providers.js";
import { getProjectIdForConnection } from "open-sse/services/projectId.js";
import { enforceApiKeyModelPolicy } from "../../services/apiKeyPolicy.js";
import { modelKindError } from ".././modelKind.js";
import REGISTRY from "open-sse/providers/registry/index.js";
import { getProviderValidationGuard } from "open-sse/utils/outboundUrlGuard.js";
import { createQuotaReservationLifecycle } from "@/shared/services/quotaSelection";
import { buildQuotaResourceKeys, evaluateProviderQuotaPreflight } from "@/shared/services/providerQuotaPreflight";
import { refreshProviderQuota } from "@/shared/services/providerQuotaTracker";
import { isNumber, isObject, isString } from "../../../shared/utils/typeChecks.js";
import { requestAborted } from "./shared.js";

const ANTIGRAVITY_CAPACITY_SWEEP_RETRIES = 2;
const MAX_ACCOUNT_ATTEMPTS_PER_REQUEST = 1024;
const ANTIGRAVITY_STRIKE_WINDOW_MS = 60_000;
const ANTIGRAVITY_STRIKE_BLOCK_MS = 15 * 60_000;
// Google's quota API can report remaining quota while generation endpoints
// keep returning 429 for other reasons (content-triggered rejections). Only
// count a 429 toward the strike breaker when parseUpstreamError found an
// actual quota marker in the raw body (result.antigravityQuotaSignal); the
// client-facing result.error is always the redacted "Rate limit exceeded"
// message for every 429, so matching markers against it never fires. A
// generic 429 still gets the normal cooldown but never trips the breaker.
const antigravity429Strikes = new Map();

function antigravityStrikeKey(connectionId, model) {
  return `${connectionId}|${model}`;
}

function clearAntigravity429Strikes(connectionId, model) {
  antigravity429Strikes.delete(antigravityStrikeKey(connectionId, model));
}

function recordAntigravity429Strike(connectionId, model, now = Date.now()) {
  const key = antigravityStrikeKey(connectionId, model);
  const previous = antigravity429Strikes.get(key);
  // First strike anchors the window; success resets it, and threshold expiry is persisted through the existing model-lock path.
  const strike = !previous || now - previous.windowStartedAt > ANTIGRAVITY_STRIKE_WINDOW_MS ?
  { count: 1, windowStartedAt: now } :
  { count: previous.count + 1, windowStartedAt: previous.windowStartedAt };
  if (strike.count < 3) {
    antigravity429Strikes.set(key, strike);
    return null;
  }
  antigravity429Strikes.delete(key);
  return now + ANTIGRAVITY_STRIKE_BLOCK_MS;
}

export function __resetAntigravity429StrikesForTests() {
  antigravity429Strikes.clear();
}

function aggregateRateLimitBlockers(blockers, extra = null) {
  const entries = [...blockers.values()];
  if (extra) entries.push(extra);
  if (entries.length === 0 || entries.some((entry) => Number(entry.status) !== 429)) return null;
  const complete = entries.every((entry) => entry.retryAtKnown !== false && Boolean(entry.retryAt));
  const retryAt = complete ?
  entries.map((entry) => entry.retryAt).sort((left, right) => Date.parse(left) - Date.parse(right))[0] :
  null;
  return { status: 429, retryAt };
}

function proxyOptionsFromCredentials(credentials) {
  const config = credentials?.providerSpecificData || {};
  return {
    connectionProxyEnabled: config.connectionProxyEnabled === true,
    connectionProxyUrl: config.connectionProxyUrl || "",
    connectionNoProxy: config.connectionNoProxy || "",
    vercelRelayUrl: config.vercelRelayUrl || "",
    strictProxy: config.strictProxy === true,
    disableEnvProxy: config.disableEnvProxy === true
  };
}
const LIVE_MODEL_FETCHER_TYPES = new Set(["openai", "openai-compatible"]);
const KIMI_LIVE_MODEL_PROVIDERS = new Set(["kimi", "kimi-coding", "kimi-coding-apikey"]);

/**
 * Warm live model limits after account selection without awaiting catalog I/O.
 * The cached resolver owns TTL, negative caching, coalescing, and failures.
 */
export function warmRequestModelLimits(provider, credentials) {
  try {
    const registry = REGISTRY.find((entry) => entry.id === provider || entry.alias === provider || entry.uiAlias === provider);
    const fetcher = registry?.modelsFetcher;
    const genericFetcher = fetcher && LIVE_MODEL_FETCHER_TYPES.has(fetcher.type) ? fetcher : null;
    const anthropic = provider?.startsWith("anthropic-compatible-");
    const compatible = anthropic || provider?.startsWith("openai-compatible-");
    const kimi = KIMI_LIVE_MODEL_PROVIDERS.has(provider);
    if (!genericFetcher && !compatible && !kimi) return;
    warmLiveModelLimits(provider, credentials, {
      guard: getProviderValidationGuard(),
      proxyOptions: proxyOptionsFromCredentials(credentials),
      endpoint: genericFetcher?.url || (kimi ? KIMI_CODING_MODELS_URL : undefined),
      anthropic
    });
  } catch {

    // Catalog metadata is optional; request dispatch must remain fail-soft.
  }}


/**
 * #6457 / OmniRoute#6525: resolved registry model kind === "image" means the
 * model is image-only and belongs on /v1/images/generations, not the chat
 * endpoint. Forwarding it to a chat upstream yields a confusing raw provider
 * 400 (e.g. HuggingFace: "not a chat model"). Per-model kind is used (not the
 * provider-level serviceKinds) because mixed providers like Cloudflare serve
 * both chat and image models.
 */
export function isImageOnlyModel(provider, model) {
  const entry = REGISTRY.find(
    (e) => e.id === provider || e.alias === provider || e.aliases?.includes(provider)
  );
  const m = entry?.models?.find((x) => x.id === model);
  return (m?.kind ?? m?.type) === "image";
}

/**
 * A model that can never answer a chat request: a System One decision model,
 * or any model of a provider with no chat transport and no `llm` service kind
 * (see open-sse/providers/chatCapability.js).
 */
export function isNonChatModel(provider, model) {
  return isNativeOnlyModel(provider, model) || !isChatProvider(provider);
}

// Keep quota-only combo inspection distinct from the single-model resolution
// call below. This helper is invoked only after the shared API-key guard has
// authenticated the request, and the alias makes that security ordering
// explicit to the handler-contract source check.

/**
 * Strip reasoning_content from assistant messages in conversation history.
 * Some providers (e.g. Mistral) reject requests containing reasoning_content
 * in assistant messages with "extra_forbidden" validation errors.
 * This field is only meaningful in streaming responses, not in request bodies.
 */
function stripReasoningFromMessages(body) {
  if (!body.messages || !Array.isArray(body.messages)) return body;
  let modified = false;
  for (const msg of body.messages) {
    if (msg && msg.role === "assistant" && msg.reasoning_content !== undefined) {
      delete msg.reasoning_content;
      modified = true;
    }
  }
  return modified ? { ...body, messages: [...body.messages] } : body;
}

/**
 * Fix message ordering for providers that require specific role sequences.
 * Mistral requires the last message to be user/tool (or assistant with prefix=true).
 * If the last message is an assistant without prefix, add prefix: true so the
 * provider can continue generation from that point.
 */
function fixMessageOrdering(messages) {
  if (!messages || !Array.isArray(messages) || messages.length === 0) return;
  const last = messages[messages.length - 1];
  if (last && last.role === "assistant" && !last.prefix) {
    last.prefix = true;
  }
}


/**
 * Peek a successful single-model stream for its first content frame
 * (OmniRoute #13153/#13630). `failed` is true when the stream ended or errored
 * before any content reached the client and the failure was not
 * request-scoped (OmniRoute #14585: a sibling would reject the same request).
 * The returned response always replays the consumed bytes, so passing it on
 * is identical to the original stream. Content already sent is never retried:
 * nothing is forwarded until the peek settles.
 *
 * This sits inside the account loop, below the transient 5xx retry wrapper
 * (runWithTransientBackendRetry). The held response is a 200 stream, so an
 * early EOF never multiplies into whole-request retries.
 *
 * @param {Response} response
 * @param {number} [peekMs] peek window; 0 disables the hold
 * @returns {Promise<{response: Response, failed: boolean}>}
 */
export async function holdForEarlyEof(response, peekMs = STREAM_EARLY_EOF_PEEK_MS) {
  if (peekMs <= 0) return { response, failed: false };
  const peek = await peekStreamForContent(response, peekMs);
  if (!peek.body) return { response, failed: false };
  const replay = new Response(peek.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
  const failed = (peek.outcome === "empty" || peek.outcome === "error") &&
  !isRequestScopedStreamError(peek.streamError);
  return { response: replay, failed };
}

async function buildSingleModelCapabilitiesMap(modelStr) {
  const resolved = await getModelInfo(modelStr);
  if (!resolved?.provider || !resolved?.model) return null;
  const requestPrefix = parseModel(modelStr).providerAlias || null;
  const caps = await loadCustomCapabilities(resolved.provider, resolved.model, requestPrefix);
  return caps;
}

/**
 * Handle single model chat request
 * Fusion and fallback with tool-output images use local policy markers
 * through nested attempts to classify all-candidate ACL denials. Nested combo
 * dispatch is supplied by the caller to keep routing dependencies one-way.
 */
export async function handleSingleModelChat(body, modelStr, clientRawRequest = null, request = null, apiKey = null, attemptSignal = null, tokenSaverCollector = null, options = {}) {
  const { settings = null, allowVisionBridge = false, preResolvedCapabilities = undefined, apiKeyName = apiKey ? "Unknown API Key" : "Local (No API Key)", apiKeyId = null, billingEpoch, comboRouting = null, comboPrompts = [], comboVisited = new Set(), planRequest, reportComboPolicyRejections = false, dispatchNestedCombo } = options;
  const requestSignal = attemptSignal || request?.signal || null;
  if (requestAborted(request, requestSignal)) return errorResponse(499, "Request aborted");
  const modelInfo = await getModelInfo(modelStr);

  if (!modelInfo.provider) return dispatchNestedCombo({ body, modelStr, clientRawRequest, request, apiKey, tokenSaverCollector, requestSignal, comboRouting, comboPrompts, comboVisited, planRequest, apiKeyName, apiKeyId, billingEpoch, reportComboPolicyRejections });

  const { provider, model } = modelInfo;
  const privatePlan = provider === "chatgpt-plan";

  // Reject image-only models routed to /v1/chat/completions (#6457 / #6525).
  // getModelInfo already resolved the registry {provider, model}; a kind:"image"
  // entry belongs on /v1/images/generations. Guard fires before credentials /
  // dispatch so the upstream is never called.
  if (isImageOnlyModel(provider, model)) {
    log.warn("CHAT", `Rejecting image-generation model on chat endpoint: ${provider}/${model}`);
    return errorResponse(
      HTTP_STATUS.BAD_REQUEST,
      `Model '${provider}/${model}' is an image-generation model and cannot be used on /v1/chat/completions. Use POST /v1/images/generations instead.`
    );
  }

  if (isNonChatModel(provider, model)) {
    log.warn("CHAT", `Rejecting non-chat model on chat endpoint: ${provider}/${model}`);
    return errorResponse(
      HTTP_STATUS.BAD_REQUEST,
      `Model '${provider}/${model}' is not a chat model and cannot be used on the chat endpoints.`
    );
  }

  // Enforce per-API-key model policy against the resolved underlying model when
  // the request started as a combo; the top-level combo name is not a model id.
  const policyError2 = await enforceApiKeyModelPolicy(request, `${provider}/${model}`, apiKey);
  if (policyError2) return reportComboPolicyRejections && policyError2.status === HTTP_STATUS.FORBIDDEN ? comboPolicyRejection() : policyError2;

  // Mixed providers also expose speech and embedding models; reject declared
  // non-chat kinds before selecting an account, while allowing unknown IDs.
  const kindError = await modelKindError(provider, model, settings, "llm", ["llm", "imageToText", "audio"]);
  if (kindError) return kindError;

  // Vision Bridge (#6640): after policy passes, resolve custom capabilities and
  // reroute vision requests to the configured vision-capable model. Denied
  // requests never reach this DB lookup. Combo members resolve their own caps
  // upstream; this branch is only for single-model requests.
  let modelCapabilities = preResolvedCapabilities;
  if (!privatePlan && allowVisionBridge && settings?.visionBridgeEnabled === true && modelCapabilities === undefined) {
    const singleModelCaps = await buildSingleModelCapabilitiesMap(modelStr);
    const visionTargetCaps = settings?.visionBridgeModel ?
    await buildSingleModelCapabilitiesMap(String(settings.visionBridgeModel)) :
    null;
    const vb = applyVisionBridgeReroute({ body, modelStr, settings, capabilities: singleModelCaps, targetCapabilities: visionTargetCaps });
    if (vb.rerouted) {
      const policyError = await enforceApiKeyModelPolicy(request, vb.modelStr, apiKey);
      if (policyError) {
        log.warn("CHAT", `Vision Bridge target "${vb.toModel}" denied by API key policy; keeping "${modelStr}"`);
      } else {
        log.info("CHAT", `Vision Bridge reroute: ${vb.fromModel} -> ${vb.toModel}`);
        // Re-resolve provider/model for the rerouted target and recurse into the
        // retry loop with vision bridge disabled to prevent loops. The body/model
        // update is scoped to the recursive call so the original stays intact.
        const reroutedInfo = await getModelInfo(vb.modelStr);
        if (reroutedInfo?.provider) {
          return handleSingleModelChat(
            vb.body,
            vb.modelStr,
            clientRawRequest,
            request,
            apiKey,
            attemptSignal,
            tokenSaverCollector,
            { settings, planRequest, allowVisionBridge: false, preResolvedCapabilities: visionTargetCaps, apiKeyName, apiKeyId, billingEpoch }
          );
        }
        // Invalid reroute target: fall through to original model.
      }
    }
    if (vb.toolOutputVision) {
      log.warn("CHAT", `Vision Bridge could not serve a tool-output image for "${modelStr}"`);
      return errorResponse(
        HTTP_STATUS.BAD_REQUEST,
        `Model '${modelStr}' cannot read images returned by a tool, and no permitted Vision Bridge target is available.`,
        { code: "capability_unavailable" }
      );
    }
    modelCapabilities = singleModelCaps;
  }

  // Pin the request to a specific connection when the client asks for one.
  // The header is preferred; body fields are accepted for backwards-compatible
  // clients but stripped before the core sees them.
  const rawConnectionPin = request.headers.get("x-connection-id") ||
  body.connectionId ||
  body.connection_id ||
  null;
  let preferredConnectionId = null;
  if (rawConnectionPin && !privatePlan) {
    const requestedId = String(rawConnectionPin);
    const canonicalProvider = resolveProviderId(provider);
    const scopedConnectionIds = apiKeyId ? await getApiKeyProviderConnectionIds(apiKeyId) : [];
    if (scopedConnectionIds.length > 0 && !scopedConnectionIds.includes(requestedId)) {
      log.warn("CHAT", `[${provider}/${model}] pinned connection ${requestedId.slice(0, 8)} not in scope for API key`);
      return errorResponse(HTTP_STATUS.BAD_REQUEST, "Requested connection is not available for this API key");
    }
    const activeConnections = await getProviderConnections({ provider: canonicalProvider, isActive: true });
    const pinnedConnection = activeConnections.find((c) => c.id === requestedId);
    if (!pinnedConnection) {
      log.warn("CHAT", `x-connection-id not found for provider ${canonicalProvider}: ${requestedId.slice(0, 8)}`);
      return errorResponse(
        HTTP_STATUS.BAD_REQUEST,
        `Connection ${requestedId.slice(0, 8)}... is not active for provider '${canonicalProvider}'.`
      );
    }
    preferredConnectionId = pinnedConnection.id;
    log.info("CHAT", `[${provider}/${model}] pinned to connection ${preferredConnectionId.slice(0, 8)}`);
  }
  // Strip router-only connection pin from upstream request body.
  if (body.connectionId !== undefined || body.connection_id !== undefined) {
    body = { ...body };
    delete body.connectionId;
    delete body.connection_id;
  }

  // Strip reasoning_content for providers that reject it (Mistral, etc.)
  // Preserve for providers that require it (DeepSeek thinking mode)
  if (!provider.startsWith("deepseek")) {
    body = stripReasoningFromMessages(body);
  }
  // Fix message ordering for all providers (prefix: true for last assistant)
  fixMessageOrdering(body.messages);

  // Routing shown in the unified "▶" line (client model → provider/model)

  // Extract userAgent from request
  const userAgent = request?.headers?.get("user-agent") || "";

  const routingSessionId = resolveClientSessionId({
    headers: clientRawRequest?.headers,
    body,
    scope: provider
  });

  // Resolve request-scoped custom capabilities once, just before the retry loop.
  // Custom model aliases are stored by provider prefix; requestPrefix carries
  // the prefix the caller actually used (e.g. node alias or bare model alias).
  const parsed = parseModel(modelStr);
  const requestPrefix = parsed?.providerAlias || null;
  // The direct single-model path already resolved caps for the vision bridge;
  // reuse that result (undefined = not resolved yet). Combo attempts pass
  // undefined so each member resolves its own caps.
  const resolvedModelCapabilities = modelCapabilities !== undefined ?
  modelCapabilities :
  await loadCustomCapabilities(provider, model, requestPrefix);

  // Recheck concrete leaves after alias/custom-capability resolution. Nested
  // combo capability unions are admission hints, not proof this leaf can read it.
  const fusionRequiredInput = getFusionRequiredInput(body);
  const effectiveFusionCapabilities = enforceCursorCapabilities(provider, {
    ...getCapabilitiesForModel(provider, parseSuffix(model).cleanModel),
    ...(resolvedModelCapabilities || {}),
  });
  if (fusionRequiredInput.some((cap) => effectiveFusionCapabilities[cap] !== true)) {
    return new Response(
      JSON.stringify({ error: { message: `Fusion requires [${fusionRequiredInput.join(",")}] input support`, type: "invalid_request_error", code: "capability_unavailable" } }),
      { status: HTTP_STATUS.BAD_REQUEST, headers: { "Content-Type": "application/json" } }
    );
  }

  if (privatePlan) {
    const pathname = request?.url ? new URL(request.url).pathname : "";
    if (!/\/v1\/(chat\/completions|messages)\/?$/.test(pathname)) {
      return errorResponse(HTTP_STATUS.BAD_REQUEST, "ChatGPT plan is only available on Chat Completions and Messages");
    }
    const dispatch = await resolveChatgptPlanDispatch({
      planRequest,
      providerRegistered: REGISTRY.some((entry) => entry.id === provider),
      preferredConnectionId: rawConnectionPin ? String(rawConnectionPin) : null,
      comboRouting,
      signal: requestSignal,
    });
    if (!dispatch) {
      return reportComboPolicyRejections ? comboPolicyRejection() :
        errorResponse(HTTP_STATUS.FORBIDDEN, "ChatGPT plan connection is not available for this API key");
    }

    // The normal account recovery loop may rotate credentials. This dispatch
    // uses the common translation/usage pipeline with its own bound executor.
    const result = await handleChatCore({
      ...dispatch,
      body: { ...structuredClone(body), model: `${provider}/${model}` },
      modelInfo,
      modelCapabilities: resolvedModelCapabilities,
      clientRawRequest,
      userAgent,
      apiKey,
      apiKeyId,
      apiKeyName,
      billingEpoch,
      comboId: comboRouting?.id,
      comboName: comboRouting?.name,
      comboNoLog: comboRouting?.noLog === true,
      comboPrompts,
      log,
      routingPolicy: settings?.openrouterRouting,
      providerConcurrencyLimit: settings?.providerConcurrencyLimits,
      globalConcurrentRequests: settings?.globalConcurrentRequests,
      sourceFormatOverride: detectFormatByEndpoint(pathname, body),
      abortSignal: requestSignal,
    });
    if (result.localAdmissionRejected === true) result.response.localAdmissionRejected = true;
    return result.success ? withRouteResponseHeaders(result.response, { provider, model }) : result.response;
  }

  // Try with available accounts (fallback on errors)
  const excludeConnectionIds = new Set();
  const attemptCounts = new Map();
  const attemptedBlockers = new Map();
  const refreshedQuotaConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;
  let antigravityTimeoutResponse = null;
  let antigravityCapacitySweeps = 0;
  let totalAttempts = 0;
  let requestReplayConnectionId = null;
  let requestReplayAttempted = false;
  // Early-EOF sibling failover (OmniRoute #13153/#13630): at most ONE hop per
  // request. Holds the first attempt's replayable response so an exhausted
  // sibling pool still returns exactly what the client would have received.
  let earlyEofOriginal = null;
  const providerAlias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  // Quota/cooldown keys follow the tier row chatCore will dispatch (client
  // effort/budget and the provider-level thinking override pick `-<tier>` rows).
  const quotaSettings = settings || await getSettings();
  const upstreamModel = getDispatchUpstreamModelId(providerAlias, model, body, quotaSettings?.providerThinking?.[provider]);
  const quotaFamily = getModelQuotaFamily(providerAlias, model);
  const modelCandidates = [...new Set([model, upstreamModel].filter(Boolean))];
  const quotaResourceKeys = buildQuotaResourceKeys({ provider, modelCandidates, quotaFamily });

  // Token Saver telemetry (port of 9router #2562): capture the LATEST routing
  // attempt's normalized event; fallback retries overwrite it. When a parent
  // combo passes a collector, feed events into it and skip the local finally
  // persistence so the whole combo writes one row. Otherwise persist once in
  // finally (success, terminal error, abort, or throw) so one logical request
  // = one row and retries never double-count.
  let lastTokenSaverEvent = null;
  let accountAttempts = 0;
  try {
    while (true) {
      if (requestAborted(request, requestSignal)) return errorResponse(499, "Request aborted");
      let credentials;
      try {
        credentials = await getProviderCredentialsWithQuotaPreflight(provider, excludeConnectionIds, model, {
          connectionRecovery: true,
          signal: requestSignal,
          modelCandidates,
          healthModel: upstreamModel || model,
          quotaFamily,
          resourceKeys: quotaResourceKeys,
          sessionId: routingSessionId,
          preferredConnectionId: preferredConnectionId || requestReplayConnectionId,
          apiKeyId,
          allowedConnectionIds: comboRouting?.allowedConnectionIds || null,
          restrictionApplied: comboRouting?.restrictionApplied === true,
          reportScopeDenied: reportComboPolicyRejections
        });
      } catch (error) {
        if (error?.name === "AbortError" || requestAborted(request, requestSignal)) return errorResponse(499, "Request aborted");
        throw error;
      }

      if (credentials?.scopeDenied === true) return comboPolicyRejection();

      // If the caller pinned a connection, the selected credential must match it
      // exactly. Otherwise the account has been excluded/quota-blocked/rotated and
      // the pin is no longer honored.
      if (preferredConnectionId && credentials?.connectionId && credentials.connectionId !== preferredConnectionId) {
        log.warn("CHAT", `[${provider}/${model}] pinned connection ${preferredConnectionId.slice(0, 8)} not selected; refusing rotation`);
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `Connection ${preferredConnectionId.slice(0, 8)}... is not available for provider '${provider}'.`);
      }

      // All accounts unavailable or provider disabled
      if (credentials?.connectionRecoveryBusy) {
        const response = errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, "Connection recovery in progress");
        response.localAdmissionRejected = true;
        return response;
      }
      if (!credentials || credentials.allRateLimited || credentials.providerDisabled) {
        if (antigravityTimeoutResponse && !credentials?.providerDisabled) return antigravityTimeoutResponse;
        if (earlyEofOriginal) return earlyEofOriginal;
        if (credentials?.providerDisabled) {
          log.warn("CHAT", `[${provider}/${model}] free no-auth provider disabled by settings`);
          return errorResponse(HTTP_STATUS.FORBIDDEN, `Provider '${provider}' is disabled. Enable it in Settings > Providers.`);
        }
        if (credentials?.allRateLimited) {
          const rawStatus = credentials.lastErrorCode;
          const parsedStatus = isNumber(rawStatus) || isString(rawStatus) ? Number(rawStatus) : NaN;
          const validStoredStatus = Number.isInteger(parsedStatus) && parsedStatus >= 400 && parsedStatus <= 599;
          const storedStatus = validStoredStatus ? parsedStatus : HTTP_STATUS.SERVICE_UNAVAILABLE;
          const combinedRateLimit = aggregateRateLimitBlockers(attemptedBlockers, {
            status: storedStatus,
            retryAt: credentials.retryAfter || null,
            retryAtKnown: Boolean(credentials.retryAfter)
          });
          const status = combinedRateLimit?.status || (
          validStoredStatus && storedStatus !== 429 ? storedStatus : lastStatus || storedStatus);
          const errorMsg = status === storedStatus && (validStoredStatus || !lastStatus) ?
          credentials.lastError || "Unavailable" :
          lastError || credentials.lastError || "Unavailable";
          const retryAfter = combinedRateLimit ? combinedRateLimit.retryAt : credentials.retryAfter;
          log.warn("CHAT", `[${provider}/${model}] all accounts unavailable`);
          notifyWebhookEvent("provider.unavailable", { provider, model, status }, { throttleKey: `${provider}/${model}` });
          return unavailableResponse(getClientStatusFromError(status, errorMsg), `[${provider}/${model}] ${errorMsg}`, retryAfter, retryAfter ? credentials.retryAfterHuman : "");
        }
        if (excludeConnectionIds.size === 0) {
          // 404 is right either way here, because /v1/models filters on isActive too,
          // so the model genuinely is not in the catalogue. What differs is why.
          if (isRoutableProvider(provider)) {
            log.warn("AUTH", `No active credentials for provider: ${provider}`);
            return errorResponse(
              HTTP_STATUS.NOT_FOUND,
              `No active credentials for provider: ${provider}. Connect an account for this provider in the dashboard.`,
              { code: "provider_not_configured" },
            );
          }
          log.warn("AUTH", `Unknown provider: ${provider}`);
          return errorResponse(
            HTTP_STATUS.NOT_FOUND,
            `Unknown provider "${provider}" in model "${provider}/${model}". See /v1/models for what this router serves.`,
          );
        }
        if (
        (provider === "antigravity" || provider === "agy") &&
        isAntigravityCapacityError(lastStatus, lastError) &&
        antigravityCapacitySweeps < ANTIGRAVITY_CAPACITY_SWEEP_RETRIES)
        {
          antigravityCapacitySweeps += 1;
          log.warn("CHAT", `[${provider}/${model}] all accounts reported capacity; restarting account sweep ${antigravityCapacitySweeps}/${ANTIGRAVITY_CAPACITY_SWEEP_RETRIES}`);
          excludeConnectionIds.clear();
          continue;
        }
        log.warn("CHAT", "No more accounts available", { provider });
        notifyWebhookEvent("provider.unavailable", { provider, model, status: lastStatus || null }, { throttleKey: `${provider}/${model}` });
        const attemptedRateLimit = aggregateRateLimitBlockers(attemptedBlockers);
        if (attemptedRateLimit) {
          return unavailableResponse(429, `[${provider}/${model}] ${lastError || "Rate limit exceeded"}`, attemptedRateLimit.retryAt, "");
        }
        return errorResponse(getClientStatusFromError(lastStatus, lastError), lastError || "All accounts unavailable");
      }

      const allowedAttempts = provider === "antigravity" || provider === "agy" ?
      ANTIGRAVITY_CAPACITY_SWEEP_RETRIES + 1 :
      1;
      const priorAttempts = attemptCounts.get(credentials.connectionId) || 0;
      if (priorAttempts >= allowedAttempts || totalAttempts >= MAX_ACCOUNT_ATTEMPTS_PER_REQUEST) {
        excludeConnectionIds.add(credentials.connectionId);
        if (totalAttempts >= MAX_ACCOUNT_ATTEMPTS_PER_REQUEST) {
          if (antigravityTimeoutResponse) return antigravityTimeoutResponse;
          if (earlyEofOriginal) return earlyEofOriginal;
          log.warn("FALLBACK", "Provider fallback attempt bound reached");
          const attemptedRateLimit = aggregateRateLimitBlockers(attemptedBlockers);
          if (attemptedRateLimit) {
            return unavailableResponse(429, `[${provider}/${model}] ${lastError || "Rate limit exceeded"}`, attemptedRateLimit.retryAt, "");
          }
          return errorResponse(getClientStatusFromError(lastStatus, lastError), lastError || "All accounts unavailable");
        }
        continue;
      }
      attemptCounts.set(credentials.connectionId, priorAttempts + 1);
      totalAttempts += 1;

      if (requestAborted(request, requestSignal)) return errorResponse(499, "Request aborted");

      // Account selection shown in the unified "▶" line (acc:...). OAuth
      // rotation goes through the shared CAS coordinator used by quota refresh.
      let activeConnection = credentials._connection || null;
      let refreshedCredentials = credentials;
      if (activeConnection?.authType === "oauth") {
        try {
          const refreshed = await refreshAndUpdateCredentials(
            activeConnection,
            false,
            proxyOptionsFromCredentials(credentials),
            { signal: requestSignal, log }
          );
          activeConnection = refreshed.connection;
          refreshedCredentials = await projectProviderCredentials(activeConnection, credentials._quotaPreflight);
        } catch (error) {
          if (error?.name === "AbortError") return errorResponse(499, "Request aborted");
          log.warn("TOKEN", "Proactive credential refresh failed; attempting existing credential");
        }
      }

      if (requestAborted(request, requestSignal)) return errorResponse(499, "Request aborted");

      // Ensure real project ID is available for providers that need it (P0 fix: cold miss)
      if ((provider === "antigravity" || provider === "agy" || provider === "gemini-cli") && !refreshedCredentials.projectId) {
        try {
          const pid = await getProjectIdForConnection(
            credentials.connectionId,
            refreshedCredentials.accessToken,
            refreshedCredentials.providerSpecificData,
            requestSignal,
            provider
          );
          if (requestAborted(request, requestSignal)) return errorResponse(499, "Request aborted");
          if (pid) {
            refreshedCredentials.projectId = pid;
            // Persist only after the subscriber is still live; a disconnected
            // request must not schedule a late credential write.
            updateProviderCredentials(credentials.connectionId, { projectId: pid }).catch(() => {});
          }
        } catch (error) {
          if (error?.name === "AbortError" || requestAborted(request, requestSignal)) {
            return errorResponse(499, "Request aborted");
          }
          if ((provider === "antigravity" || provider === "agy") && error?.credentialScoped) {
            lastStatus = error.status || HTTP_STATUS.SERVICE_UNAVAILABLE;
            lastError = "Antigravity credential project validation failed";
            await markAccountUnavailable(credentials.connectionId, lastStatus, lastError, provider, model, null, { signal: requestSignal });
            excludeConnectionIds.add(credentials.connectionId);
            continue;
          }
        }
      }
      if (requestAborted(request, requestSignal)) return errorResponse(499, "Request aborted");
      warmRequestModelLimits(provider, refreshedCredentials);
      // Bind later outcome writes to the stored credential this attempt sends.
      const { credentialFingerprint: dispatchedCredential } = credentialDispatchSnapshot(refreshedCredentials);

      // Use shared chatCore
      const chatSettings = await getSettings();
      if (requestAborted(request, requestSignal)) return errorResponse(499, "Request aborted");
      const providerThinking = (chatSettings.providerThinking || {})[provider] || null;
      const pxpipeTransform = chatSettings.pxpipeEnabled ? await getPxpipeTransform() : null;
      if (requestAborted(request, requestSignal)) return errorResponse(499, "Request aborted");
      let latestAttemptStartedAt = null;
      const quotaReservation = createQuotaReservationLifecycle({
        quotaProfile: credentials._quotaPreflight?.quotaProfile || null,
        connectionId: credentials.connectionId,
        provider,
        routeKey: `${provider}/${model}`,
        config: chatSettings.quotaSelection || {}
      });
      const cookieRefreshContext = activeConnection?.authType === "cookie"
        ? providerRefreshContext({
          id: refreshedCredentials.connectionId,
          provider: activeConnection.provider,
          authType: activeConnection.authType,
          apiKey: refreshedCredentials.apiKey,
          providerSpecificData: refreshedCredentials.providerSpecificData
        })
        : null;
      const healthAttempt = model && healthEnabled(provider, chatSettings) ? antigravityHealth.begin(credentials.connectionId, upstreamModel || model, true) : null;
      if (model && healthEnabled(provider, chatSettings) && !healthAttempt) {
        if (preferredConnectionId) return errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, "Connection recovery in progress");
        excludeConnectionIds.add(credentials.connectionId);
        continue;
      }
      const cancelHealthAttempt = () => healthAttempt?.finish("ignored");
      requestSignal?.addEventListener("abort", cancelHealthAttempt, { once: true });
      if (requestSignal?.aborted) cancelHealthAttempt();
      let result;
      try {
        result = await runWithConnectionRecovery(handleChatCore, {
        body: { ...structuredClone(body), model: `${provider}/${model}` },
        modelInfo: { provider, model },
        modelCapabilities: resolvedModelCapabilities,
        credentials: refreshedCredentials,
        log,
        clientRawRequest,
        connectionId: credentials.connectionId,
        userAgent,
        apiKey,
        apiKeyId,
        apiKeyName,
        billingEpoch,
        abortSignal: requestSignal,
        // #747: outer-combo attribution; nested merge narrowed eligibility
        // (comboRouting.allowedConnectionIds) without changing attribution.
        comboId: comboRouting?.id || null,
        comboName: comboRouting?.name || null,
        comboNoLog: comboRouting?.noLog === true,
        quotaReservation,
        onProviderAttempt: () => {
          accountAttempts++;
          latestAttemptStartedAt = allocateProviderAttemptTimestamp();
          return latestAttemptStartedAt;
        },
        ccFilterNaming: !!chatSettings.ccFilterNaming,
        rtkEnabled: !!chatSettings.rtkEnabled,
        headroomEnabled: !!chatSettings.headroomEnabled,
        headroomUrl: chatSettings.headroomUrl || DEFAULT_HEADROOM_URL,
        headroomCompressUserMessages: !!chatSettings.headroomCompressUserMessages,
        headroomTimeoutMs: chatSettings.headroomTimeoutMs,
        pxpipeEnabled: !!chatSettings.pxpipeEnabled,
        cavemanEnabled: !!chatSettings.cavemanEnabled,
        cavemanLevel: chatSettings.cavemanLevel || "full",
        ponytailEnabled: !!chatSettings.ponytailEnabled,
        ponytailLevel: chatSettings.ponytailLevel || "full",
        customPromptEnabled: !!chatSettings.customPromptEnabled,
        customPrompt: chatSettings.customPrompt || "",
        comboPrompts,
        pxpipeMinChars: chatSettings.pxpipeMinChars,
        pxpipeTimeoutMs: chatSettings.pxpipeTimeoutMs,
        pxpipeTransform,
        pxpipeAllowedModels: chatSettings.pxpipeAllowedModels,
        onPxpipeEvent: appendPxpipeEvent,
        onHeadroomEvent: appendHeadroomEvent,
        onTokenSaverEvent: (event) => {
          if (tokenSaverCollector) {
            tokenSaverCollector.latest = event;
          } else {
            lastTokenSaverEvent = event;
          }
        },
        providerThinking,
        routingPolicy: chatSettings.openrouterRouting,
        providerConcurrencyLimit: chatSettings.providerConcurrencyLimits,
        globalConcurrentRequests: chatSettings.globalConcurrentRequests,
        claudeClassifierCompat: ["off", "auto", "always"].includes(chatSettings.claudeClassifierCompat) ?
        chatSettings.claudeClassifierCompat :
        "off",
        compressionEnabled: !!chatSettings.compressionEnabled,
        compressionEngines: chatSettings.compressionEngines || {},
        contentMasking: chatSettings.contentMasking ?? null,
        compressionFidelityGate: chatSettings.compressionFidelityGate === true,
        compressionAdaptive: chatSettings.compressionAdaptive ?? null,
        // Detect source format by endpoint + body
        sourceFormatOverride: request?.url ? detectFormatByEndpoint(new URL(request.url).pathname, body) : null,
        // A durable credential (OrcaRouter) has nothing to refresh: injecting the
        // refresher would hand chatCore the same rejected key to retry.
        ...(activeConnection?.authType === "oauth" && !isDurableCredentialProvider(activeConnection.provider) ? {
          refreshCredentials: async ({ signal, force = true } = {}) => {
            const refreshed = await refreshAndUpdateCredentials(
              activeConnection,
              force,
              proxyOptionsFromCredentials(refreshedCredentials),
              { signal, log }
            );
            activeConnection = refreshed.connection;
            refreshedCredentials = await projectProviderCredentials(activeConnection, credentials._quotaPreflight);
            return refreshedCredentials;
          }
        } : null),
        // Non-OAuth sessions that rotate their own credentials report them here.
        // kimi-web returns a new token pair plus `providerSpecificPatch`; keep it
        // in the encrypted token columns so the next request and a restart start
        // from it. Web-cookie executors (chatgpt-web) hand back a rotated session
        // cookie as `apiKey`. PromptQL saves its derived credentials against the
        // sending cookie so a concurrent re-import cannot receive a stale token.
        ...(activeConnection && activeConnection.authType !== "oauth" ? {
          onCredentialsRefreshed: async (next) => {
            if (provider === "promptql" && cookieRefreshContext && next?.promptqlSession) {
              return updateProviderConnection(credentials.connectionId, {
                accessToken: next.accessToken,
                providerSpecificData: next.promptqlSession
              }, { expectedRefreshContext: cookieRefreshContext });
            }
            if (next?.providerSpecificPatch) {
              await updateProviderCredentials(credentials.connectionId, {
                accessToken: next.accessToken,
                refreshToken: next.refreshToken,
                providerSpecificData: next.providerSpecificPatch,
                existingProviderSpecificData: activeConnection.providerSpecificData
              });
              return;
            }
            const rotated = next?.apiKey;
            if (!cookieRefreshContext || !isString(rotated) || !rotated) return;
            if (rotated === cookieRefreshContext.apiKey) return;
            return updateProviderCredentials(credentials.connectionId, { rotatedApiKey: rotated }, {
              expectedRefreshContext: cookieRefreshContext
            });
          }
        } : null),
        onRequestSuccess: async ({ attemptStartedAt = latestAttemptStartedAt } = {}) => {
          if (provider === "antigravity" || provider === "agy") {
            clearAntigravity429Strikes(credentials.connectionId, model);
          }
          if (!Number.isSafeInteger(attemptStartedAt) || attemptStartedAt <= 0) return;
          await clearAccountError(credentials.connectionId, refreshedCredentials, model, {
            provider,
            attemptStartedAt,
            credentialFingerprint: dispatchedCredential,
            signal: requestSignal
          });
        },
        // Streaming headers are already committed when emptiness becomes known.
        // Bench this account so the client's retry selects another candidate.
        onEmptyStream: async () => {
          if (!Number.isSafeInteger(latestAttemptStartedAt) || latestAttemptStartedAt <= 0) return;
          await markAccountUnavailable(
            credentials.connectionId,
            HTTP_STATUS.BAD_GATEWAY,
            `Empty streaming response from ${provider}/${model}`,
            provider,
            model,
            Date.now() + EMPTY_CONTENT_COOLDOWN_MS,
            { attemptStartedAt: latestAttemptStartedAt, credentialFingerprint: dispatchedCredential, signal: requestSignal }
          );
        },
        // Empty-stream retries exhausted mid-stream (headers already sent, so no
        // pre-stream fallback is possible): bench the account so the client's
        // automatic retry of the in-stream error lands on the next one. Quota
        // exhaustion passes a precise resetsAtMs instead of the generic cooldown.
        onUpstreamEmptyExhausted: async (reason, resetsAtMs) => {
          if (!Number.isSafeInteger(latestAttemptStartedAt) || latestAttemptStartedAt <= 0) return;
          await markAccountUnavailable(credentials.connectionId, HTTP_STATUS.BAD_GATEWAY, reason, provider, model, resetsAtMs, {
            attemptStartedAt: latestAttemptStartedAt,
            credentialFingerprint: dispatchedCredential,
            signal: requestSignal
          });
        }
      }, activeConnection, model, resolveFallbackModelScope(provider, model), requestSignal);
      } catch (error) {
        cancelHealthAttempt();
        throw error;
      } finally {
        requestSignal?.removeEventListener("abort", cancelHealthAttempt);
      }
      if (result.success) result.response = trackHealthResponse(result.response, healthAttempt, requestSignal);
      else healthAttempt?.finish(!requestAborted(request, requestSignal) && result.antigravityPreResponseTimeout === true ? "timeout" : "ignored");

      if (result.connectionRecoveryBusy) {
        if (preferredConnectionId) {
          result.response.localAdmissionRejected = true;
          return result.response;
        }
        excludeConnectionIds.add(credentials.connectionId);
        continue;
      }

      if (result.success) {
        if (result.claudeFast) {
          const response = withRouteResponseHeaders(result.response, { provider, model, attempts: Math.max(1, accountAttempts) });
          response.claudeFast = true;
          return response;
        }
        if (earlyEofOriginal || preferredConnectionId) return withRouteResponseHeaders(result.response, { provider, model, attempts: Math.max(1, accountAttempts) });
        const held = await holdForEarlyEof(result.response);
        if (!held.failed || requestAborted(request, requestSignal)) return withRouteResponseHeaders(held.response, { provider, model, attempts: Math.max(1, accountAttempts) });
        log.warn("STREAM", `[${provider}/${model}] ACC:${credentials.connectionId.slice(0, 8)} stream ended before any content; trying one sibling`);
        earlyEofOriginal = held.response;
        excludeConnectionIds.add(credentials.connectionId);
        continue;
      }
      if (result.claudeRequestScoped) {
        result.response.claudeRequestScoped = true;
        return result.response;
      }
      if (antigravityTimeoutResponse) result.response.skipAntigravityTimeoutReplay = true;
      // Process-local admission pressure is terminal for this request. Retrying a
      // sibling would hit the same queue and must not cool a healthy account.
      if (result.localSchemaError === true) return result.response;
      if (result.localAdmissionRejected === true) {
        // Keep explicit locality on the Response across the outer transient retry.
        result.response.localAdmissionRejected = true;
        return result.response;
      }
      // A client-side abort (named AbortError, or a bare request_signal_aborted /
      // "Client disconnected" / "operation was aborted" that defaulted to 502) is a
      // local stream lifecycle event, NOT a provider failure. Return without cooling
      // down the account or accruing fallback state (OmniRoute #7907/#7908).
      if (requestAborted(request, requestSignal) || result.status === 499 || isLocalStreamLifecycleError(result.error)) return result.response;
      if (result.antigravityPreResponseTimeout === true ||
          (provider === "antigravity" && result.status === HTTP_STATUS.GATEWAY_TIMEOUT)) {
        // Internal metadata stays on the Response, never in the client payload.
        result.response.skipAntigravityTimeoutReplay = true;
        if (preferredConnectionId) return result.response;
        antigravityTimeoutResponse ??= result.response;
        requestReplayConnectionId = null;
        excludeConnectionIds.add(credentials.connectionId);
        lastError = result.error;
        lastStatus = result.status;
        continue;
      }
      if (!requestReplayAttempted && isRequestReplayBufferError(result.status, result.error)) {
        requestReplayAttempted = true;
        requestReplayConnectionId = credentials.connectionId;
        attemptCounts.delete(credentials.connectionId);
        log.warn("RETRY", `ACC:${credentials.connectionName} replaying once after upstream request-buffer overflow`);
        continue;
      }
      if (preferredConnectionId) {
        // A pinned connection must not rotate. Return the failure response immediately.
        log.warn("CHAT", `[${provider}/${model}] pinned connection ${preferredConnectionId.slice(0, 8)} failed; pin is terminal`);
        return result.response;
      }
      if (result.quotaCapacityUnavailable) {
        // A local atomic-capacity race is not provider evidence. Release/expiry is
        // owned by the lifecycle; exclude this account and try a sibling without
        // writing a synthetic 429 or breaker state.
        excludeConnectionIds.add(credentials.connectionId);
        lastError = "Provider quota capacity unavailable";
        lastStatus = HTTP_STATUS.SERVICE_UNAVAILABLE;
        continue;
      }

      const resultAttemptStartedAt = Number.isSafeInteger(result.attemptStartedAt) && result.attemptStartedAt > 0 ?
      result.attemptStartedAt :
      latestAttemptStartedAt;
      const resultErrorBody = result.errorBody && isObject(result.errorBody) ? result.errorBody : null;
      const resultHeaders = result.headers ?? null;
      const upstreamRequestId = ["x-request-id", "request-id", "x-correlation-id"]
        .map((name) => validateProviderRequestId(new Headers(resultHeaders || {}).get(name)))
        .find(Boolean);
      if (upstreamRequestId) {
        const responseHeaders = new Headers(result.response.headers);
        responseHeaders.set("x-upstream-request-id", upstreamRequestId);
        result.response = new Response(result.response.body, {
          status: result.response.status,
          statusText: result.response.statusText,
          headers: responseHeaders,
        });
        if (antigravityTimeoutResponse) result.response.skipAntigravityTimeoutReplay = true;
      }
      const antigravityProvider = provider === "antigravity" || provider === "agy";
      const authoritativeResetAt = Number(result.rateLimitEvidence?.resetAtMs);
      // chatCore fills result.resetsAtMs with a generic local cooldown (e.g. 2s)
      // for ANY 429 that arrives without a reset hint, including content-triggered
      // ones. That value is a client-side guess, not upstream evidence, so it must
      // never count as authoritative here — only a real upstream reset timestamp
      // (rateLimitEvidence.resetAtMs) does. Using the local fallback would make
      // every antigravity 429 look "authoritative" and defeat the strike breaker.
      const authoritativeReset = Number.isFinite(authoritativeResetAt) && authoritativeResetAt > Date.now();
      if (antigravityProvider && result.status === 429 && authoritativeReset) {
        clearAntigravity429Strikes(credentials.connectionId, model);
      }
      /**
       * Antigravity 409s and 429s without executor reset metadata may describe
       * exact model quota. Refresh the shared repository before creating any
       * legacy lock; only a fresh exact-source blocker owns the reselect.
       */
      // A parsed detail-free response is request-scoped; keep the account selectable.
      const requestScopedAntigravity = antigravityProvider && result.noQuotaMetadata === true && !authoritativeReset && !result.antigravityQuotaSignal;
      const shouldRefreshAntigravityQuota =
        antigravityProvider && !requestScopedAntigravity &&
        (result.status === 409 || (result.status === 429 && !authoritativeReset)) &&
        activeConnection &&
        !refreshedQuotaConnectionIds.has(credentials.connectionId);
      if (shouldRefreshAntigravityQuota) {
        refreshedQuotaConnectionIds.add(credentials.connectionId);
        try {
          const refreshResult = await refreshProviderQuota(activeConnection, {
            signal: requestSignal,
            force: true
          });
          const decision = refreshResult?.outcome === "success" && Array.isArray(refreshResult.snapshots) ?
          evaluateProviderQuotaPreflight(refreshResult.snapshots, {
            connectionId: credentials.connectionId,
            provider,
            resourceKeys: quotaResourceKeys,
            now: Date.now(),
            refreshSupported: true
          }) :
          null;
          if (decision?.skip) {
            clearAntigravity429Strikes(credentials.connectionId, model);
            log.info("AUTH", `${provider} | refreshed quota blocked ${credentials.connectionId.slice(0, 8)} (reason=${decision.reason || "unknown"}); reselecting`);
            lastError = result.error;
            lastStatus = result.status;
            continue;
          }
        } catch (error) {
          if (error?.name === "AbortError" || requestAborted(request, requestSignal)) {
            return errorResponse(499, "Request aborted");
          }
          log.warn("QUOTA", `${provider} | reactive quota refresh failed for ${credentials.connectionId.slice(0, 8)}; using standard fallback`);
        }
      }

      const strikeBreakerResetAt = antigravityProvider && result.status === 429 && !authoritativeReset && result.antigravityQuotaSignal === true ?
      recordAntigravity429Strike(credentials.connectionId, model) :
      null;
      // A locally synthesized short 429 delay is not a quota reset. Let the
      // Antigravity account policy choose its exhaustion default instead.
      const creditsExhausted = antigravityProvider && result.status === 429 && !authoritativeReset &&
        /google_one_ai|insufficient[_ ](?:g1_)?credits?|not enough credits?|credits? exhausted|credit balance|minimumcreditamountforusage|g1_credits/i.test(`${result.error || ""} ${JSON.stringify(resultErrorBody || {})}`);
      const fallbackResetAt = creditsExhausted ? null : strikeBreakerResetAt ?? result.resetsAtMs;
      const fallbackEvidence = creditsExhausted ? { state: "exhausted", resetAtMs: null, source: "antigravity_credits" } : strikeBreakerResetAt === null ?
      result.rateLimitEvidence || null :
      { state: result.rateLimitEvidence?.state === "exhausted" ? "exhausted" : "cooldown", resetAtMs: strikeBreakerResetAt, source: "antigravity_strike_breaker" };

      if (requestScopedAntigravity) return result.response;

      const fallbackState = await markAccountUnavailable(
        credentials.connectionId,
        result.status,
        result.error,
        provider,
        model,
        fallbackResetAt,
        {
          attemptStartedAt: resultAttemptStartedAt,
          rateLimitEvidence: fallbackEvidence,
          headers: resultHeaders,
          errorBody: resultErrorBody,
          // The credential this attempt actually presented, so a durable-key
          // provider can mark exactly the generation that was rejected.
          usedCredential: credentials.accessToken || credentials.apiKey || null,
          credentialFingerprint: dispatchedCredential,
          // Proven relay/hop provenance from the fork's own transport layer.
          // Null for an ordinary upstream HTTP response, which is a provider
          // answer rather than a hop failure.
          transportFailure: result.transportFailure ?? null,
          // Accounts this request already excluded cannot serve it again, so
          // they are not alternatives for the cooldown decision.
          excludedConnectionIds: excludeConnectionIds,
          hasComboFallback: comboRouting !== null,
          signal: requestSignal
        }
      );
      const { shouldFallback } = fallbackState;

      if (shouldFallback) {
        attemptedBlockers.set(credentials.connectionId, {
          status: Number(result.status) || 503,
          retryAt: fallbackState.retryAt || null,
          retryAtKnown: fallbackState.retryAtKnown !== false
        });
        log.warn("FALLBACK", `⇄ ACC:${credentials.connectionId.slice(0, 8)} UNAVAILABLE (${result.status}) → NEXT ACCOUNT`);
        excludeConnectionIds.add(credentials.connectionId);
        lastError = result.error;
        lastStatus = result.status;
        continue;
      }

      return result.response;
    }
  } finally {
    // Persist the latest routing attempt's event once per logical request.
    // Awaited so the row is durable before the response returns (fail-open
    // inside recordTokenSaverEvent — it catches DB errors and never throws).
    // Skip when a collector is in use; the owner persists after all attempts.
    if (lastTokenSaverEvent && !tokenSaverCollector) await recordTokenSaverEvent(lastTokenSaverEvent);
  }
}

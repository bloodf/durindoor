import "open-sse/index.js";
import { parseAutoModel } from "../services/autoModel.js";
import { admit } from "../services/admission.js";
import { summarizeToolSources } from "../utils/toolSources.js";
import { CAPTURE_CONSENT_HEADER, CAPTURE_SESSION_HEADER, prepareMessageCapture } from "../utils/messageCapture.js";
import { usageAttributionFromHeaders } from "@/lib/usageAttribution.js";
import { normalizeModelReference, parseModel } from "open-sse/services/model.js";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { cacheClaudeHeaders } from "open-sse/utils/claudeHeaderCache.js";
import { getApiKeyByKey, getApiKeyById, getApiKeyUsageLimitStatus, getComboForModel } from "@/lib/localDb";
import { getComboCanonicalName, createRoutableModelIdChecker } from "../services/model.js";
import { isAutoComboId } from "open-sse/services/autoComboResolver.js";
import { decodeClaudeCodeModelId } from "../../shared/models/_claudeCompat.js";
import { authErrorResponse, errorResponse } from "open-sse/utils/error.js";
import { getRequestId, withRequestCorrelation } from "../utils/requestCorrelation.js";
import { handleBypassRequest } from "open-sse/utils/bypassHandler.js";
import { handlePonytailCommands, DEFAULT_PONYTAIL_HELP, resolvePonytailStream } from "open-sse/utils/tokenSaverBridge.js";
import { resolveTokenSaverEnabled } from "open-sse/rtk/index.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { FORMATS, detectFormatByEndpoint } from "open-sse/translator/formats.js";
import { detectFormat } from "open-sse/services/provider.js";
import * as log from "../utils/logger.js";
import { holdReservationForResponse, releaseLifetimeTokens, reserveLifetimeTokens } from "@/lib/apiKeyTokenReservations.js";
import { getBatchRequestKeyId } from "../services/batchKeyIdentity.js";
import { decodeAnthropicRequest } from "../utils/inboundGzip.js";
import { isApiKeyExpired } from "@/shared/utils/apiKeyExpiry";
import { enforceApiKeyLimits } from "@/lib/apiKeyLimits.js";
import { annotateClientAdmissionFailure } from "open-sse/services/operationalMetrics.js";
import { validateChatRequestBody } from "open-sse/translator/validate.js";
import { initTranslators } from "open-sse/translator/index.js";
import { requestAborted } from "./chat/shared.js";
import { dispatchChat } from "./chat/combo.js";
import { toResponsesContextFailure } from "./chat/contextOverflow.js";
export { resolveComboModelTimeoutMs, rankComboModelsByLocks, rankComboModelsByQuota, resolveComboCapabilitiesMap } from "./chat/combo.js";
export { __resetAntigravity429StrikesForTests, warmRequestModelLimits, isImageOnlyModel, isNonChatModel, holdForEarlyEof } from "./chat/singleModel.js";


let translatorInitialization;

function initializeTranslators() {
  translatorInitialization ??= Promise.resolve().then(() => initTranslators());
  return translatorInitialization;
}

async function handleChatHandler(request, clientRawRequest = null, requestId = getRequestId(request)) {
  await initializeTranslators();
  if (requestAborted(request)) return errorResponse(499, "Request aborted");
  let body;
  try {
    body = await request.json();
  } catch {
    log.warn("CHAT", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  // Inbound schema guard (OmniRoute O-A): reject malformed `messages` / `model`
  // / scalar params with a clear 400 BEFORE auth + model resolution, so a bad
  // body never surfaces as a misleading `model_not_found` 404 or an unsanitized
  // 500. See open-sse/translator/validate.js (ports #6515/#6433/#6437).
  const earlyRejection = validateChatRequestBody(body);
  if (earlyRejection) {
    log.warn("CHAT", "Rejecting schema-invalid request body");
    return earlyRejection;
  }

  const originalClientModel = body.model;
  // Keep model identity outside mutable working bodies: combo attempts replace
  // their routed model, but Claude response metadata must echo this exact value.
  if (!clientRawRequest) {
    const url = new URL(request.url);
    clientRawRequest = {
      endpoint: url.pathname,
      body: { ...body },
      headers: Object.fromEntries(request.headers.entries()),
      originalModel: originalClientModel,
      requestId,
    };
  } else {
    clientRawRequest = { ...clientRawRequest, originalModel: originalClientModel, requestId };
  }
  // Capture control headers stay in the gateway, outside provider headers and request logs.
  if (request.headers.has(CAPTURE_CONSENT_HEADER) || request.headers.has(CAPTURE_SESSION_HEADER)) {
    const headers = { ...clientRawRequest.headers };
    delete headers[CAPTURE_CONSENT_HEADER];
    delete headers[CAPTURE_SESSION_HEADER];
    clientRawRequest.headers = headers;
  }
  cacheClaudeHeaders(clientRawRequest.headers);

  const sourceFormat = detectFormatByEndpoint(
    clientRawRequest?.endpoint || new URL(request.url).pathname,
    body,
  ) || detectFormat(body);
  let modelStr = normalizeModelReference(body.model);
  if (modelStr !== body.model) body = { ...body, model: modelStr };

  // Request summary is emitted as the unified "▶" line in chatCore (has fmt/thinking/account)

  const { settings, apiKey, auth: apiKeyAuth, error: admissionError } = await admit(request, { kind: "chat", respond: (_status, message) => authErrorResponse(clientRawRequest.endpoint, message) });
  if (apiKey) {
    log.debug("AUTH", `API Key: ${log.maskKey(apiKey)}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }
  if (admissionError) {
    log.warn("AUTH", apiKeyAuth.reason === "missing" ? "Missing API key (requireApiKey=true)" : "Invalid API key");
    return admissionError;
  }
  const toolSummary = summarizeToolSources(body.tools, settings.logToolSources);
  if (toolSummary) log.debug("TOOLS", toolSummary);

  // Use only the admitted stored key and the original request headers.
  clientRawRequest.usageAttribution = apiKeyAuth.stored && apiKeyAuth.apiKeyId ?
    usageAttributionFromHeaders(request.headers) : null;

  // Keep admission identity across retries, nested combos, and fusion callbacks.
  // An import during upstream work must not turn old usage into new-generation usage.
  const billingEpoch = apiKeyAuth.billingEpoch;

  // Retain the authenticated record so local commands can expose only this
  // key's own lifetime totals. Combo ACL runs after Claude model decoding.
  let authenticatedKeyRecord = null;
  const batchKeyId = getBatchRequestKeyId(request);
  if (apiKey) authenticatedKeyRecord = batchKeyId ? await getApiKeyById(batchKeyId) : await getApiKeyByKey(apiKey);
  if (batchKeyId && (!authenticatedKeyRecord || !authenticatedKeyRecord.isActive || isApiKeyExpired(authenticatedKeyRecord.expiresAt))) {
    return annotateClientAdmissionFailure(authErrorResponse(clientRawRequest.endpoint, "Invalid API key"), "auth_invalid");
  }
  const planRequest = {
    verifiedKey: apiKeyAuth.stored === true && authenticatedKeyRecord?.id === apiKeyAuth.apiKeyId
      ? { id: authenticatedKeyRecord.id, isActive: authenticatedKeyRecord.isActive } : null,
    binding: null,
    refreshAttempted: false,
  };

  if (apiKey) {
    let limitStatus;
    try {
      limitStatus = await getApiKeyUsageLimitStatus(apiKey, new Date(), apiKeyAuth.apiKeyId);
    } catch (err) {
      if (err?.message?.includes("no such table: apiKeyUsageTotals")) {
        limitStatus = { enforced: false, exceeded: false };
      } else {
        log.error("AUTH", "Failed to load API key usage limit status", err);
        return errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, "Database temporarily unavailable");
      }
    }
    if (limitStatus.exceeded) {
      const used = Math.round(limitStatus.usedTokens);
      const limit = Math.round(limitStatus.limitTokens);
      log.warn("AUTH", `API key daily token limit exceeded (${used}/${limit})`);
      return annotateClientAdmissionFailure(errorResponse(HTTP_STATUS.RATE_LIMITED, `API key daily token limit exceeded (${used}/${limit} tokens)`), "client_limit");
    }

    // Windowed per-key limits are checked once, before combo dispatch, so a
    // key's own 429 never lowers the shared health score of combo members.
    // The per-model policy checks below skip this step for the same request.
    const windowedLimit = await enforceApiKeyLimits(request, authenticatedKeyRecord);
    if (windowedLimit) return windowedLimit;

    // Reserve the lifetime token allowance (#2833) once per request, before any
    // combo or retry dispatch; handleChat releases it when the response ends.
    if (authenticatedKeyRecord?.isActive) {
      const requested = parseModel(modelStr);
      const reservationContext = { modelMaxOutput: getCapabilitiesForModel(requested.provider, requested.model).maxOutput, sourceFormat };
      const reservation = reserveLifetimeTokens(request, authenticatedKeyRecord, body, Date.now(), reservationContext);
      if (!reservation.ok) {
        log.warn("AUTH", `API key lifetime token limit reached (${reservation.used}/${reservation.limit})`);
        return annotateClientAdmissionFailure(errorResponse(HTTP_STATUS.RATE_LIMITED,
          `API key token limit reached (${Math.round(reservation.used)}/${reservation.limit} tokens)`), "client_limit");
      }
      body = reservation.body;
    }
  }

  if (sourceFormat === FORMATS.CLAUDE) {
    modelStr = await decodeClaudeCodeModelId(modelStr, createRoutableModelIdChecker());
    if (modelStr !== body.model) body = { ...body, model: modelStr };
  }

  if (authenticatedKeyRecord && Array.isArray(authenticatedKeyRecord.allowedCombos) && authenticatedKeyRecord.allowedCombos.length > 0) {
    const comboName = await getComboCanonicalName(modelStr) || parseAutoModel(modelStr)?.name;
    if (comboName && !authenticatedKeyRecord.allowedCombos.includes(comboName)) {
      log.warn("AUTH", `API key "${authenticatedKeyRecord.name}" not allowed to access combo "${comboName}"`);
      return errorResponse(HTTP_STATUS.FORBIDDEN, `Access denied: combo "${comboName}" is not allowed for this API key`);
    }
  }

  // `auto/*` ids are virtual — synthesised in the catalog, never a stored combo
  // row — so getComboCanonicalName/resolveRequestedComboName return null for
  // them and the allowedCombos check above never runs. allowedModels also
  // can't scope them out: validateModelAccess short-circuits on the `auto/`
  // prefix. Gate them with an explicit per-key flag instead, so a key scoped
  // to one narrow lane can't reach every model on the gateway through
  // `auto/best-coding`. Absent/undefined defaults to allowed (existing keys
  // keep working); only an explicit `false` denies.
  if (authenticatedKeyRecord && authenticatedKeyRecord.policy?.allowAutoCombos === false && (isAutoComboId(modelStr) || (parseAutoModel(modelStr) && !(await getComboForModel(modelStr))))) {
    log.warn("AUTH", `API key "${authenticatedKeyRecord.name}" not allowed to use auto combos`);
    return errorResponse(HTTP_STATUS.FORBIDDEN, `Access denied: auto combos are not allowed for this API key`);
  }

  if (!modelStr) {
    log.warn("CHAT", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }

  // Vision Bridge (#6640): when the request carries image parts on its current
  // user turn and the requested model cannot accept vision natively, swap to
  // the operator-configured vision-capable model before combo/dispatch. Applied
  // after settings + auth are loaded (so parseModel stays sync/pure) and before
  // combo resolution. The rerouted target is policy-rechecked — a vision model
  // the caller's API key is not allowed to use must not be reachable via the
  // bridge; on denial we keep the original model and let normal policy gates run.
  //
  // Custom capabilities resolve BEFORE the bridge so a user-added vision override
  // on a compatible node or bare alias is honored. Both run AFTER the local
  // ponytail/bypass interceptors below — local commands must answer without
  // any model/DB lookup.
  // Per-request token-saver bypass (#2609): `X-DurinDoor-Token-Saver: off`
  // (or legacy `X-9Router-Token-Saver: off`) disables the local Ponytail
  // slash-command interceptor so the request reaches the provider untransformed.
  const tokenSaverEnabled = resolveTokenSaverEnabled(clientRawRequest?.headers);

  // Ponytail slash commands are local-only: respond before any account/credential lookup.
  const acceptHeader = clientRawRequest?.headers?.accept || "";
  if (tokenSaverEnabled) {
    const ponytailResponse = await handlePonytailCommands(body, modelStr, {
      fetchStats: authenticatedKeyRecord ?
      async () => {
        const { getApiKeyUsageTotals } = await import("@/lib/localDb");
        return {
          ...(await getApiKeyUsageTotals(authenticatedKeyRecord.id)),
          scope: "this API key"
        };
      } :
      null,
      helpText: DEFAULT_PONYTAIL_HELP,
      sourceFormatOverride: sourceFormat,
      streamOverride: resolvePonytailStream(body, sourceFormat, acceptHeader)
    });
    if (ponytailResponse?.success && ponytailResponse.response) {
      return ponytailResponse.response;
    }
  }

  // Bypass naming/warmup requests before combo rotation to avoid wasting rotation slots
  const userAgent = request?.headers?.get("user-agent") || "";
  const bypassResponse = handleBypassRequest(body, modelStr, userAgent, !!settings.ccFilterNaming);
  if (bypassResponse) return bypassResponse.response || bypassResponse;

  const captureResponse = prepareMessageCapture({
    request, body, settings, auth: apiKeyAuth, credential: apiKey, format: sourceFormat,
  });
  const finishChat = async (pending) => {
    const response = await pending;
    return captureResponse ? captureResponse(response) : response;
  };

  // Vision Bridge capability resolution and reroute have moved to
  // handleSingleModelChat so they run AFTER API-key policy enforcement for
  const response = await dispatchChat({ body, modelStr, settings, request, apiKeyAuth, apiKey, clientRawRequest, planRequest, authenticatedKeyRecord, billingEpoch, finishChat });
  // Applied after account and combo selection, which need the HTTP failure.
  return toResponsesContextFailure(response, { stream: body.stream, sourceFormat });
}

async function handleChatWithTokenReservation(inbound, ...rest) {
  // Plain requests come back unchanged; reservations are keyed on what is parsed.
  const decoded = await decodeAnthropicRequest(inbound, { abortedStatus: 499 });
  if (decoded.response) return decoded.response;
  const { request } = decoded;
  try {
    return holdReservationForResponse(request, await handleChatHandler(request, ...rest));
  } catch (error) {
    releaseLifetimeTokens(request);
    throw error;
  }
}

export const handleChat = withRequestCorrelation(handleChatWithTokenReservation);

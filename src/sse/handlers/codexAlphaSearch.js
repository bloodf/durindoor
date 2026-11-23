import { admit } from "../services/admission.js";
import { getProviderCredentialsWithQuotaPreflight, markAccountUnavailable, clearAccountError } from "../services/auth.js";
import { credentialDispatchSnapshot } from "@/shared/utils/credentialFingerprint.js";
import { getModelInfo } from "../services/model.js";
import { checkAndRefreshToken } from "../services/tokenRefresh.js";
import { enforceApiKeyModelPolicy, recordApiKeyUsageForResponse } from "../services/apiKeyPolicy.js";
import { captureRequestBillingEpoch, getRequestId } from "../utils/requestCorrelation.js";
import { createQuotaReservationLifecycle } from "@/shared/services/quotaSelection";
import { readBounded } from "open-sse/handlers/codexSttAudio.js";
import { codexHttpFetch } from "open-sse/handlers/codexStt.js";
import { resolveCodexAccountId } from "open-sse/shared/codexAccountId.js";
import { resolveCredentialProxyOptions } from "open-sse/services/oauthCredentialManager.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
import codex from "open-sse/providers/registry/codex.js";
import { errorResponse } from "open-sse/utils/error.js";
import { isObject, isString } from "@/shared/utils/typeChecks.js";

const UPSTREAM = "https://chatgpt.com/backend-api/codex/alpha/search";
const REQUEST_LIMIT = 1024 * 1024;
const RESPONSE_LIMIT = 4 * 1024 * 1024;
const safeHeader = (value, limit = 256) => isString(value) && value.length <= limit && /^[\x21-\x7e]+$/.test(value);

/** Native Codex SearchRequest; never forwards caller credentials or destinations.
 * Client authentication denials carry the shared auth_missing/auth_invalid admission annotation.
 */
export async function handleCodexAlphaSearch(request) {
  await captureRequestBillingEpoch(request);
  const { settings, apiKey, auth, error: admissionError } = await admit(request, { kind: "codexAlphaSearch" });
  if (admissionError) return admissionError;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60000)]);
  let body;
  try {
    const bytes = await readBounded(request.body, REQUEST_LIMIT, signal);
    body = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    return errorResponse(error.status === 413 ? 413 : 400, error.status === 413 ? "Search request exceeds size limit" : "Invalid search request");
  }
  if (!body || !isObject(body) || Array.isArray(body) || !isString(body.model) || !body.model.trim() || !isString(body.id) || !body.id || (body.commands != null && (!isObject(body.commands) || Array.isArray(body.commands)))) {
    return errorResponse(400, "Invalid search request");
  }
  const { provider, model } = await getModelInfo(body.model);
  if (provider !== "codex" || !model) return errorResponse(400, "A Codex model is required");
  const policyError = await enforceApiKeyModelPolicy(request, `${provider}/${model}`, apiKey);
  if (policyError) return policyError;
  // Search cooldowns must neither block nor clear this account’s chat traffic.
  const searchLockKey = `websearch:${provider}`;
  const credentials = await getProviderCredentialsWithQuotaPreflight(provider, new Set(), searchLockKey, { apiKeyId: auth.apiKeyId, webSearch: true, modelCandidates: [model] });
  if (!credentials || credentials.allRateLimited || credentials.providerDisabled) return errorResponse(credentials?.providerDisabled ? 403 : 503, "Codex account unavailable");
  if (credentials.authType !== "oauth") return errorResponse(403, "A valid Codex OAuth account is required");
  let selected;
  try { selected = await checkAndRefreshToken(provider, credentials); } catch { return errorResponse(503, "Codex account unavailable"); }
  const accountId = resolveCodexAccountId(selected.providerSpecificData, selected.idToken);
  if (selected.authType !== "oauth" || !safeHeader(selected.accessToken, 16384) || !safeHeader(accountId)) return errorResponse(403, "A valid Codex OAuth account is required");
  const proxyOptions = resolveCredentialProxyOptions(selected);
  if (proxyOptions.source === "error") return errorResponse(503, "Account proxy is unavailable");
  const quota = createQuotaReservationLifecycle({ quotaProfile: credentials._quotaPreflight?.quotaProfile || null, connectionId: credentials.connectionId, provider, routeKey: `${provider}/${model}`, config: settings.quotaSelection || {} });
  try { await quota.beginDispatch(); } catch { return errorResponse(503, "Provider quota capacity unavailable"); }
  let success = false;
  try {
    const { prompt_cache_key: _cacheKey, prompt_cache_retention: _cacheRetention, ...searchBody } = body;
    const dispatch = credentialDispatchSnapshot(selected);
    const upstream = await proxyAwareFetch(UPSTREAM, {
      method: "POST", redirect: "error", signal, directFetch: codexHttpFetch,
      headers: { Authorization: `Bearer ${selected.accessToken}`, "ChatGPT-Account-Id": accountId, "Content-Type": "application/json", Accept: "application/json", "User-Agent": codex.transport.headers["User-Agent"] },
      body: JSON.stringify({ ...searchBody, model }),
    }, proxyOptions);
    if (!upstream.ok) {
      await upstream.body?.cancel();
      const status = upstream.status >= 400 && upstream.status <= 599 ? upstream.status : 502;
      await markAccountUnavailable(credentials.connectionId, status, "Codex search failed", provider, searchLockKey, null, { usedCredential: selected.accessToken, webSearch: true, ...dispatch });
      return errorResponse(status, "Codex search failed");
    }
    const bytes = await readBounded(upstream.body, RESPONSE_LIMIT, signal, 502);
    let data;
    try { data = JSON.parse(bytes.toString("utf8")); } catch { return errorResponse(502, "Invalid Codex search response"); }
    if (!data || !isObject(data) || Array.isArray(data) || !isString(data.output) || (data.results != null && !Array.isArray(data.results)) || (data.encrypted_output != null && !isString(data.encrypted_output))) return errorResponse(502, "Invalid Codex search response");
    success = true;
    await clearAccountError(credentials.connectionId, selected, searchLockKey, { provider, webSearch: true, ...dispatch });
    return await recordApiKeyUsageForResponse(apiKey, Response.json(data), {
      apiKeyId: auth.apiKeyId, billingEpoch: auth.billingEpoch, usageEventId: `${getRequestId(request)}:codex-alpha-search`, provider, model,
      connectionId: credentials.connectionId, endpoint: "/v1/alpha/search", modality: "webSearch", tokens: {}, nativeUnits: { operations: 1 }, cost: null, costStatus: "unknown", costSource: "unavailable",
    });
  } catch (error) {
    if (error?.code === "USAGE_ACCOUNTING_FAILED") throw error;
    return errorResponse(signal.aborted ? 504 : 502, "Codex search failed");
  } finally {
    try { await quota.settle({ success, reason: success ? "success" : "upstream_error" }); } catch { console.error("[QUOTA] reservation settlement failed"); }
  }
}

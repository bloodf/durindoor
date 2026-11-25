/**
 * Search Dispatcher — routes /v1/search requests to dedicated search APIs
 * or chat-based LLM search wrappers, with retry-friendly error envelope.
 *
 * Dependency map:
 *   provider.searchConfig    → dedicated search API (callers + normalizers)
 *   provider.searchViaChat   → wrap chat-completions (chatSearch.js)
 */

import { buildSearchRequest } from "./callers.js";
import {
  assertSearchCredentialBinding,
  assertSearchCredentialRedirectBinding,
  requestCarriesSearchCredential,
  resolveSearchBaseUrl
} from "./baseUrl.js";
import { normalizeSearchResponse } from "./normalizers.js";
import { handleChatSearch } from "./chatSearch.js";
import { resolveCredentialProxyOptions } from "../../services/oauthCredentialManager.js";
import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { sanitizeErrorMessageWithSecrets } from "../../utils/error.js";
import { isString } from "../../../src/shared/utils/typeChecks.js";
import { fetchPublic } from "../../../src/shared/utils/ssrfGuard.js";
import { mediaAccounting } from "../mediaAccounting.js";

const GLOBAL_TIMEOUT_MS = 15000;
const NON_RETRIABLE = new Set([400, 401, 403, 404]);

// Redirect hops a credential-bearing request may follow on the trusted
// (registry) path. Same bound the public path uses through `fetchPublic`.
const MAX_SEARCH_REDIRECT_HOPS = 5;

const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

/** Normalize and validate query string. */
function sanitizeQuery(query) {
  if (CONTROL_CHAR_RE.test(query)) return { error: "Query contains invalid control characters" };
  const clean = query.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!clean) return { error: "Query is empty after normalization" };
  return { clean };
}

// Strip non-ASCII chars from header values (HTTP headers must be ByteString).
function sanitizeHeaders(headers) {
  if (!headers) return headers;
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = isString(v) ? v.replace(/[^\x00-\xFF]/g, "").trim() : v;
  }
  return out;
}

/** Build a JSON Response wrapper used by the auth layer. */
function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}

/** Wrap an error result with a Response object so the auth wrapper can return it directly. */
function errorResult(status, error) {
  return {
    success: false,
    status,
    error,
    response: jsonResponse({ error: { message: error, code: status } }, status)
  };
}

/** Wrap a success payload with internal accounting outside the wire response. */
function successResult(data, accounting) {
  return { success: true, data, accounting, response: jsonResponse(data, 200) };
}

/**
 * Dispatch a request to a trusted (registry) destination.
 *
 * The trusted path deliberately skips the public-only egress guard — an
 * administrator may point a provider at an internal service (a SearXNG
 * container) — so the hops are followed here instead of by the platform fetch.
 * Only a request that carries the stored credential needs that handling: it is
 * the only case where a hop can move the credential somewhere else. A request
 * without a credential keeps the platform's own redirect behavior.
 *
 * Every hop is dispatched through `dispatch`, which applies the credential
 * binding before the hop leaves the gateway.
 *
 * @param {object} input
 * @param {string} input.url Initial destination.
 * @param {object} input.init Request init (already sanitized).
 * @param {Function} input.dispatch Per-hop dispatcher.
 * @param {boolean} input.credentialBearing Whether the request carries the stored credential.
 * @param {boolean} [input.preventRedirects] The provider's no-redirect policy.
 * @returns {Promise<Response>}
 */
async function dispatchTrustedSearchRequest({ url, init, dispatch, credentialBearing, preventRedirects }) {
  if (!credentialBearing) return dispatch(url, init);
  let currentUrl = url;
  for (let hop = 0; ; hop++) {
    const res = await dispatch(currentUrl, { ...init, redirect: "manual" });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return res;
    // The no-redirect policy surfaces the redirect response instead of
    // following it, exactly as the trusted path always did.
    if (preventRedirects) return res;
    if (hop >= MAX_SEARCH_REDIRECT_HOPS) throw new Error("Blocked URL: too many redirects");
    currentUrl = new URL(location, currentUrl).toString();
  }
}

/**
 * Run a single dedicated search provider attempt.
 * @returns {Promise<{success:boolean, status?:number, error?:string, data?:object}>}
 */
async function tryDedicatedProvider({
  provider,
  providerConfig,
  body,
  credentials,
  proxyOptions,
  log,
  globalStartTime
}) {
  const startTime = Date.now();
  const token = credentials?.apiKey || credentials?.accessToken || undefined;

  if (providerConfig.authType !== "none" && !token) {
    return { success: false, status: 401, error: `No credentials for provider: ${provider.id}` };
  }

  const params = {
    query: body.query,
    searchType: body.search_type || providerConfig.searchTypes?.[0] || "web",
    maxResults: Math.min(body.max_results || providerConfig.defaultMaxResults || 5, providerConfig.maxMaxResults || 100),
    token,
    country: body.country,
    language: body.language,
    timeRange: body.time_range,
    offset: body.offset,
    domainFilter: body.domain_filter,
    contentOptions: body.content_options,
    providerOptions: body.provider_options,
    providerSpecificData: credentials?.providerSpecificData
  };

  let url, init;
  // Trust boundary (#3714 + #3793): a client-supplied provider_options.baseUrl
  // override is variable input and must stay behind the SSRF guard on every
  // redirect hop; the providerConfig default is administrator-controlled and
  // may intentionally target an internal service (e.g. a SearXNG container).
  // The operator's connection endpoint wins over a caller-supplied one, so a
  // caller can never shadow the endpoint the administrator authorized.
  let requiresPublicUrl = false;
  const providerConfigWithId = { id: provider.id, ...providerConfig };
  try {
    requiresPublicUrl = resolveSearchBaseUrl(providerConfigWithId, params).source !== "registry";
    ({ url, init } = buildSearchRequest(providerConfigWithId, params));
    // Credential binding (OmniRoute #12620): a stored search credential may
    // only travel to a destination the administrator authorized. A caller that
    // names its own endpoint for a credential-bearing provider is refused
    // before any request leaves the gateway.
    assertSearchCredentialBinding({ config: providerConfigWithId, params, url, init });
  } catch (err) {
    return { success: false, status: 400, error: err?.message || `Invalid request for ${provider.id}` };
  }

  // Timeout = min(provider timeout, remaining global)
  const remaining = GLOBAL_TIMEOUT_MS - (Date.now() - globalStartTime);
  const timeout = Math.min(providerConfig.timeoutMs || 10000, Math.max(remaining, 1000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  log?.info?.("SEARCH", `${provider.id} | "${params.query.slice(0, 80)}" | type=${params.searchType}`);

  try {
    // DurinDoor: route every request through the connection's proxy
    // (proxyAwareFetch). Client-overridden endpoints additionally go through
    // fetchPublic, which re-validates every redirect hop target (DNS + literal
    // SSRF checks); admin-configured endpoints are trusted (#3793) and keep
    // plain proxy routing.
    const proxied = (hopUrl, hopInit) => {
      const options = { ...hopInit };
      if (providerConfig.preventRedirects) options.redirect = "manual";
      return proxyAwareFetch(hopUrl, options, proxyOptions);
    };
    // Credential binding on every hop (#1073): a redirect is a second
    // destination the stored credential would travel to, so the same
    // administrator-authorization decision that guards the built request
    // guards each hop before it is dispatched. The built headers are reused
    // on purpose — they are the headers that ride along with the hop.
    const dispatch = async (hopUrl, hopInit) => {
      assertSearchCredentialRedirectBinding({
        config: providerConfigWithId,
        params,
        url: hopUrl,
        init
      });
      return proxied(hopUrl, hopInit);
    };
    const requestInit = { ...init, headers: sanitizeHeaders(init.headers), signal: controller.signal };
    const publicOptions = { fetchImpl: dispatch };
    if (providerConfig.preventRedirects) publicOptions.maxRedirects = 0;
    const resp = requiresPublicUrl ?
    await fetchPublic(url, requestInit, publicOptions) :
    await dispatchTrustedSearchRequest({
      url,
      init: requestInit,
      dispatch,
      // Only a request that actually carries the stored credential needs the
      // hop-by-hop handling; a keyless request keeps the platform's own
      // redirect behavior on the trusted path.
      credentialBearing: requestCarriesSearchCredential(url, init.headers, params.token),
      preventRedirects: providerConfig.preventRedirects
    });
    clearTimeout(timer);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      const safeError = sanitizeErrorMessageWithSecrets(errText, [credentials?.apiKey, credentials?.accessToken, credentials?.refreshToken, credentials?.idToken]).slice(0, 200);
      log?.error?.("SEARCH", `${provider.id} ${resp.status}: ${safeError}`);
      return {
        success: false,
        status: resp.status,
        error: `${provider.id} returned ${resp.status}: ${safeError}`
      };
    }
    const data = await resp.json();
    const accounting = mediaAccounting(data, provider.id, "search");
    const normalized = normalizeSearchResponse(provider.id, data, params.query, params.searchType, params.domainFilter);
    const results = normalized.results.slice(0, params.maxResults);
    const duration = Date.now() - startTime;

    return {
      success: true,
      accounting,
      data: {
        provider: provider.id,
        query: params.query,
        results,
        answer: null,
        usage: { queries_used: 1, search_cost_usd: providerConfig.costByMode ? (providerConfig.costByMode[JSON.parse(init.body).mode] ?? providerConfig.costPerQuery) + Math.max(0, results.length - providerConfig.includedResults) * providerConfig.extraResultCost : providerConfig.costPerQuery || 0 },
        metrics: { response_time_ms: duration, upstream_latency_ms: duration, total_results_available: normalized.totalResults },
        errors: []
      }
    };
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err.name === "AbortError";
    const status = isTimeout ? 504 : 502;
    const safeError = sanitizeErrorMessageWithSecrets(err?.message, [credentials?.apiKey, credentials?.accessToken, credentials?.refreshToken, credentials?.idToken]);
    log?.error?.("SEARCH", `${provider.id} ${isTimeout ? "timeout" : "error"}: ${safeError}`);
    return {
      success: false,
      status,
      error: `${provider.id} ${isTimeout ? "timeout" : "error"}: ${safeError}`
    };
  }
}

/**
 * Core search handler. Dispatches to dedicated API or chat-based LLM.
 * Same calling convention as handleEmbeddingsCore: returns `{success, response, status?, error?}`.
 *
 * @param {object}   options
 * @param {object}   options.body            Sanitized body from auth wrapper
 * @param {object}   options.provider        Provider entry from AI_PROVIDERS
 * @param {object}   [options.providerConfig] Provider's searchConfig (if dedicated)
 * @param {object|null} options.credentials  Provider credentials
 * @param {object}   [options.log]           Logger
 */
export async function handleSearchCore({ body, provider, providerConfig, credentials, log, onRequestSuccess }) {
  const globalStartTime = Date.now();
  const proxyOptions = resolveCredentialProxyOptions(credentials);

  // 1. Sanitize query
  const { clean, error: sanitizeError } = sanitizeQuery(body.query || "");
  if (sanitizeError) return errorResult(400, sanitizeError);
  const normalizedBody = { ...body, query: clean };

  // 2. Route: dedicated search API takes priority over chat-based
  let result;
  if (providerConfig) {
    result = await tryDedicatedProvider({
      provider,
      providerConfig,
      body: normalizedBody,
      credentials,
      proxyOptions,
      log,
      globalStartTime
    });
  } else if (provider.searchViaChat) {
    result = await handleChatSearch({
      provider: provider.id,
      query: clean,
      maxResults: normalizedBody.max_results,
      model: provider.searchViaChat.defaultModel,
      credentials,
      proxyOptions,
      log
    });
  } else {
    return errorResult(400, `Provider ${provider.id} does not support web search`);
  }

  if (result.success) {
    await onRequestSuccess?.();
    return successResult(result.data, result.accounting);
  }

  // 3. Failover within global timeout for retriable errors
  if (
  !NON_RETRIABLE.has(result.status || 0) &&
  Date.now() - globalStartTime < GLOBAL_TIMEOUT_MS &&
  provider.searchViaChat &&
  providerConfig)
  {
    log?.warn?.("SEARCH", `${provider.id} dedicated failed (${result.status}), falling back to chat-based search`);
    const fallback = await handleChatSearch({
      provider: provider.id,
      query: clean,
      maxResults: normalizedBody.max_results,
      model: provider.searchViaChat.defaultModel,
      credentials,
      proxyOptions,
      log
    });
    if (fallback.success) {
      await onRequestSuccess?.();
      return successResult(fallback.data, fallback.accounting);
    }
  }

  return errorResult(result.status || 502, result.error || "Search failed");
}
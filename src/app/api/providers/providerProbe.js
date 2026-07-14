import { getDefaultModel, PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";
import { PROVIDERS } from "open-sse/config/providers.js";
import { normalizeAccountIdPlaceholder } from "open-sse/executors/default.js";
import { openaiToCommandCodeRequest } from "open-sse/translator/request/openai-to-commandcode.js";
import { assertOutboundUrlAllowed, getProviderValidationGuard } from "open-sse/utils/outboundUrlGuard.js";
import { extractKimiJwt, KIMI_WEB_DISCOVERY_HEADERS } from "@/lib/providers/webCookieAuth.js";

const AUTH_FAILURE_STATUSES = new Set([401, 403]);
const CHAT_PROBE_ACCEPT_STATUSES = new Set([400, 422, 429]);

function getChatProbeError(status) {
  if (AUTH_FAILURE_STATUSES.has(status)) return "Invalid API key";
  if (status === 404) return "Provider validation endpoint not found";
  if (status >= 500) return "Provider unavailable - try again later";
  return `Provider validation failed (HTTP ${status ?? "unknown"})`;
}

function appendUrlSuffix(url, suffix) {
  if (!suffix) return url;
  if (url.includes("?") && suffix.startsWith("?")) return `${url}&${suffix.slice(1)}`;
  return `${url}${suffix}`;
}

export function buildProviderProbeHeaders(cfg, apiKey) {
  const headers = {
    "Content-Type": "application/json",
    ...(cfg.headers || {}),
  };
  const auth = cfg.auth || {};
  const headerName = auth.header || (cfg.authHeader === "x-api-key" ? "X-API-Key" : "Authorization");
  const scheme = auth.scheme || (cfg.authHeader === "x-api-key" ? "raw" : "bearer");

  if (!apiKey) return headers;

  if (scheme === "raw") headers[headerName] = apiKey;
  else headers[headerName] = `${scheme[0].toUpperCase()}${scheme.slice(1)} ${apiKey}`;

  for (const spec of auth.extraHeaders || []) {
    if (spec?.from === "apiKey" && apiKey) headers[spec.header] = apiKey;
  }

  return headers;
}

export function buildRegistryProviderProbe(provider, apiKey, providerSpecificData = {}) {
  const cfg = PROVIDERS[provider];
  if (!cfg?.baseUrl) return null;

  // Registries with a `{accountId}` URL placeholder (e.g. Snowflake) need the
  // saved connection's providerSpecificData resolved into the probe URL —
  // mirrors DefaultExecutor.buildUrl's runtime resolution.
  const baseUrl = cfg.baseUrl.includes("{accountId}")
    ? cfg.baseUrl.replace("{accountId}", normalizeAccountIdPlaceholder(provider, providerSpecificData?.accountId))
    : cfg.baseUrl;

  const headers = buildProviderProbeHeaders(cfg, apiKey);
  if (cfg.noAuth && !apiKey) return { url: cfg.validateUrl || baseUrl, options: { headers }, accepts: "always" };

  if (cfg.format === "claude") {
    return {
      url: appendUrlSuffix(baseUrl, cfg.urlSuffix),
      options: {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: getDefaultModel(provider) || "claude-3-haiku-20240307",
          max_tokens: 1,
          messages: [{ role: "user", content: "test" }],
        }),
        signal: AbortSignal.timeout(10000),
      },
      accepts: "non-auth-failure",
    };
  }

  if (cfg.format === "commandcode") {
    const alias = PROVIDER_ID_TO_ALIAS[provider] ?? provider;
    const model = cfg.validationModelId || getDefaultModel(alias) || "command-code";
    return {
      url: baseUrl,
      options: {
        method: "POST",
        headers: {
          ...headers,
          "x-session-id": crypto.randomUUID(),
          "Authorization": headers.Authorization || `Bearer ${apiKey}`,
        },
        body: JSON.stringify(
          openaiToCommandCodeRequest(model, {
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 1,
            stream: false,
          }, false)
        ),
        signal: AbortSignal.timeout(10000),
      },
      accepts: "chat-auth",
    };
  }

  if (cfg.format !== "openai") return null;

  // Kimi Web (www.kimi.com) is a cookie-authed Connect-RPC provider. The user
  // pastes a full Cookie header; only the extracted `kimi-auth` JWT must reach
  // the wire — never the raw blob. Probe the same models endpoint the dashboard
  // discovery route uses so a valid cookie yields 200 and a bad one 401.
  if (provider === "kimi-web") {
    const jwt = extractKimiJwt(apiKey);
    if (!jwt) return null;
    return {
      url: "https://www.kimi.com/apiv2/kimi.gateway.config.v1.ConfigService/GetAvailableModels",
      options: {
        method: "POST",
        headers: {
          ...KIMI_WEB_DISCOVERY_HEADERS,
          Authorization: `Bearer ${jwt}`,
          Cookie: `kimi-auth=${jwt}`,
        },
        body: "{}",
        signal: AbortSignal.timeout(8000),
      },
      accepts: "ok",
    };
  }

  if (cfg.validateUrl) {
    return {
      url: cfg.validateUrl,
      options: { headers, signal: AbortSignal.timeout(8000) },
      fallback: {
        url: baseUrl,
        options: {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: getDefaultModel(provider) || "test",
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 1,
          }),
          signal: AbortSignal.timeout(10000),
        },
      },
      accepts: "ok",
    };
  }

  if (cfg.probeUsesBaseUrl) {
    const alias = PROVIDER_ID_TO_ALIAS[provider] ?? provider;
    return {
      url: baseUrl,
      options: {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: getDefaultModel(alias) || "test",
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(10000),
      },
      accepts: "chat-auth",
    };
  }
  return {
    url: baseUrl.replace(/\/chat\/completions$/, "/models").replace(/\/chatbot$/, "/models"),
    options: { headers, signal: AbortSignal.timeout(8000) },
    fallback: {
      url: baseUrl,
      options: {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: getDefaultModel(provider) || "test",
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(10000),
      },
    },
    accepts: "ok",
  };
}

export async function probeRegistryProvider(provider, apiKey, fetcher = fetch, providerSpecificData = {}) {
  const probe = buildRegistryProviderProbe(provider, apiKey, providerSpecificData);
  if (!probe) return null;
  if (probe.accepts === "always") return { valid: true, status: 200 };

  // SSRF guard (#6542): provider validation hits a caller-controllable baseUrl
  // (e.g. OpenAI-compatible `${baseUrl}/models` + the chat fallback). Validate
  // BOTH URLs before any socket opens, and forbid 3xx redirects so a provider
  // cannot redirect the probe to cloud-metadata past the initial-URL check.
  const guard = getProviderValidationGuard();
  try {
    assertOutboundUrlAllowed(probe.url, guard);
    if (probe.fallback?.url) assertOutboundUrlAllowed(probe.fallback.url, guard);
  } catch (err) {
    return {
      valid: false,
      status: null,
      error: err?.message || "Provider URL blocked by SSRF guard",
      blocked: true,
    };
  }
  const noRedirect = { redirect: "manual" };
  probe.options = { ...probe.options, ...noRedirect };
  if (probe.fallback?.options) probe.fallback.options = { ...probe.fallback.options, ...noRedirect };

  let res;
  try {
    res = await fetcher(probe.url, probe.options);
  } catch (err) {
    if (probe.accepts === "chat-auth") {
      return {
        valid: false,
        status: null,
        error: "Provider unavailable - network request failed",
      };
    }
    if (!probe.fallback) throw err;
  }
  if (probe.accepts === "non-auth-failure") {
    return { valid: !AUTH_FAILURE_STATUSES.has(res.status), status: res.status };
  }
  if (probe.accepts === "chat-auth") {
    const valid = Boolean(res?.ok || CHAT_PROBE_ACCEPT_STATUSES.has(res?.status));
    if (valid) return { valid: true, status: res?.status };
    return { valid: false, status: res?.status, error: getChatProbeError(res?.status) };
  }
  if (res && (res.ok || !probe.fallback || AUTH_FAILURE_STATUSES.has(res.status))) {
    return { valid: res.ok, status: res.status };
  }

  const fallbackRes = await fetcher(probe.fallback.url, probe.fallback.options);
  return { valid: !AUTH_FAILURE_STATUSES.has(fallbackRes.status), status: fallbackRes.status };
}

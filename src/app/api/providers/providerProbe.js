import { getDefaultModel } from "open-sse/config/providerModels.js";
import { PROVIDERS } from "open-sse/config/providers.js";
import { normalizeAccountIdPlaceholder } from "open-sse/executors/default.js";
import { openaiToCommandCodeRequest } from "open-sse/translator/request/openai-to-commandcode.js";

const AUTH_FAILURE_STATUSES = new Set([401, 403]);

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
    const model = getDefaultModel(provider) || "command-code";
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
      accepts: "non-auth-failure",
    };
  }

  if (cfg.format !== "openai") return null;

  return {
    url: cfg.validateUrl || baseUrl.replace(/\/chat\/completions$/, "/models").replace(/\/chatbot$/, "/models"),
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

  let res;
  try {
    res = await fetcher(probe.url, probe.options);
  } catch (err) {
    if (!probe.fallback) throw err;
  }
  if (probe.accepts === "non-auth-failure") {
    return { valid: !AUTH_FAILURE_STATUSES.has(res.status), status: res.status };
  }
  if (res && (res.ok || !probe.fallback || AUTH_FAILURE_STATUSES.has(res.status))) {
    return { valid: res.ok, status: res.status };
  }

  const fallbackRes = await fetcher(probe.fallback.url, probe.fallback.options);
  return { valid: !AUTH_FAILURE_STATUSES.has(fallbackRes.status), status: fallbackRes.status };
}

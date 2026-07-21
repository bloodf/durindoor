/**
 * Pure, side-effect-free health probe for a single provider connection.
 *
 * Used by the health monitor (background polling). Unlike
 * `testSingleConnection` (`src/app/api/providers/[id]/test/testUtils.js`), this
 * NEVER writes `testStatus`/`lastError` to the DB — a polling monitor must not
 * mutate connection state on every tick.
 *
 * Covers every connection kind the user can configure:
 *   - registry providers (OpenAI/Claude/commandcode/etc.) via `probeRegistryProvider`
 *   - custom OpenAI-compatible (`openai-compatible-*`) → `${baseUrl}/models`
 *   - custom Anthropic-compatible (`anthropic-compatible-*`) → normalized base URL + `/v1/messages`
 *   - local OpenAI-compatible (lm-studio, vllm, …) → `${baseUrl}/models`
 *
 * Every probe is:
 *   - SSRF-guarded via `assertOutboundUrlAllowed` / `guardedProbeFetch` (O-B #191)
 *   - proxy-aware via the saved connection proxy / proxy pool
 *     (`resolveConnectionProxyConfig` + `proxyAwareFetch`), so a provider only
 *     reachable through its configured proxy is not falsely reported down.
 *
 * Returns a normalized `{ valid, status, blocked?, error? }`. 401/403 are NOT
 * `valid` but the caller classifies them as `degraded` (reachable, bad creds)
 * rather than `down`.
 */
import { PROVIDERS } from "open-sse/config/providers.js";
import REGISTRY from "open-sse/providers/registry/index.js";
import {
  guardedProbeFetch,
  assertOutboundUrlAllowed,
  getProviderValidationGuard,
  OutboundUrlGuardError,
} from "open-sse/utils/outboundUrlGuard.js";
import { sanitizeErrorMessage } from "open-sse/utils/error.js";
import {
  isOpenAICompatibleProvider,
  isAnthropicCompatibleProvider,
} from "@/shared/constants/providers";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";

const PROBE_TIMEOUT_MS = 5000;
const AUTH_FAILURE_STATUSES = new Set([401, 403]);
const REGISTRY_BY_ID = new Map(REGISTRY.map((e) => [e.id, e]));
const isRegistryNoAuth = (providerId) => REGISTRY_BY_ID.get(providerId)?.noAuth === true;

/**
 * Fetch honoring the connection's saved proxy / proxy pool. Falls back to plain
 * `fetch` when no proxy is configured. `fetcher` is injectable for tests.
 *
 * Always forces `redirect: "manual"` so a 3xx cannot bounce the probe past the
 * initial-URL SSRF check to cloud-metadata/RFC1918. `assertOutboundUrlAllowed`
 * is called by each probe before this runs; the relay/proxy URL is trusted by
 * operator config, but the TARGET stays checked.
 */
async function proxyAware(url, options, effectiveProxy, fetcher) {
  const baseFetcher = fetcher ?? fetch;
  const opts = { ...options, redirect: "manual" };
  if (effectiveProxy?.vercelRelayUrl) {
    const { proxyAwareFetch } = await import("open-sse/utils/proxyFetch.js");
    return proxyAwareFetch(url, opts, { vercelRelayUrl: effectiveProxy.vercelRelayUrl });
  }
  if (effectiveProxy?.connectionProxyEnabled && effectiveProxy?.connectionProxyUrl) {
    const { proxyAwareFetch } = await import("open-sse/utils/proxyFetch.js");
    return proxyAwareFetch(url, opts, {
      connectionProxyEnabled: true,
      connectionProxyUrl: effectiveProxy.connectionProxyUrl,
      connectionNoProxy: effectiveProxy.connectionNoProxy || "",
    });
  }
  // No proxy: still go through the SSRF guard.
  return guardedProbeFetch(url, opts, getProviderValidationGuard(), baseFetcher);
}

function withTimeout(options) {
  return { ...options, signal: options.signal ?? AbortSignal.timeout(PROBE_TIMEOUT_MS) };
}

async function probeOpenAICompatible(connection, effectiveProxy, fetcher) {
  const baseUrl = connection.providerSpecificData?.baseUrl;
  if (!baseUrl) return { valid: false, status: null, unconfigured: true, error: "Missing base URL" };
  const url = `${String(baseUrl).replace(/\/$/, "")}/models`;
  try {
    assertOutboundUrlAllowed(url);
    const headers = connection.apiKey ? { Authorization: `Bearer ${connection.apiKey}` } : {};
    const res = await proxyAware(url, withTimeout({ headers }), effectiveProxy, fetcher);
    if (res.ok) return { valid: true, status: res.status };
    if (AUTH_FAILURE_STATUSES.has(res.status)) return { valid: false, status: res.status, error: "Invalid API key" };
    return { valid: false, status: res.status, error: `HTTP ${res.status}` };
  } catch (err) {
    if (err instanceof OutboundUrlGuardError) return { valid: false, status: null, blocked: true, error: err.message };
    return { valid: false, status: null, error: err.message };
  }
}

async function probeAnthropicCompatible(connection, effectiveProxy, fetcher) {
  let baseUrl = connection.providerSpecificData?.baseUrl;
  if (!baseUrl) return { valid: false, status: null, unconfigured: true, error: "Missing base URL" };
  baseUrl = String(baseUrl).replace(/\/$/, "");
  if (baseUrl.endsWith("/messages")) baseUrl = baseUrl.slice(0, -9);
  if (baseUrl.endsWith("/v1")) baseUrl = baseUrl.slice(0, -3);
  const url = `${baseUrl}/v1/messages`;
  const model = connection.defaultModel || "claude-3-haiku-20240307";
  try {
    assertOutboundUrlAllowed(url);
    const res = await proxyAware(
      url,
      withTimeout({
        method: "POST",
        headers: {
          "x-api-key": connection.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          Authorization: `Bearer ${connection.apiKey}`,
        },
        body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
      }),
      effectiveProxy,
      fetcher
    );
    // Anthropic chat probes: 2xx plus the known "key accepted, request
    // rejected" statuses (400/422/429) confirm reachability. 401/403 = bad key
    // (degraded). 5xx (including 529 overloaded) = outage (down).
    if (res.ok || [400, 422, 429].includes(res.status)) {
      return { valid: true, status: res.status, error: null };
    }
    if (AUTH_FAILURE_STATUSES.has(res.status)) {
      return { valid: false, status: res.status, error: "Invalid API key" };
    }
    return { valid: false, status: res.status, error: `HTTP ${res.status}` };
  } catch (err) {
    if (err instanceof OutboundUrlGuardError) return { valid: false, status: null, blocked: true, error: err.message };
    return { valid: false, status: null, error: err.message };
  }
}

const LOCAL_OPENAI_COMPATIBLE_PROVIDERS = new Set([
  "9router", "ollama-local", "lm-studio", "vllm", "lemonade", "llamafile", "llama-cpp",
  "triton", "docker-model-runner", "xinference", "oobabooga",
]);

async function probeLocalOpenAI(connection, effectiveProxy, fetcher) {
  const cfg = PROVIDERS[connection.provider];
  const raw = connection.providerSpecificData?.baseUrl || connection.baseUrl || cfg?.baseUrl;
  if (!raw) return null; // fall through to registry probe
  const base = String(raw).replace(/\/chat\/completions\/?$/, "").replace(/\/+$/, "");
  const url = `${base}/models`;
  try {
    assertOutboundUrlAllowed(url);
    const headers = connection.apiKey ? { Authorization: `Bearer ${connection.apiKey}` } : {};
    const res = await proxyAware(url, withTimeout({ headers }), effectiveProxy, fetcher);
    if (res.ok) return { valid: true, status: res.status };
    if (AUTH_FAILURE_STATUSES.has(res.status)) return { valid: false, status: res.status, error: "Invalid API key" };
    return { valid: false, status: res.status, error: `HTTP ${res.status}` };
  } catch (err) {
    if (err instanceof OutboundUrlGuardError) return { valid: false, status: null, blocked: true, error: err.message };
    return { valid: false, status: null, error: err.message };
  }
}

function httpProbeTarget(connection) {
  // A real provider-host URL for a registry noAuth transport. We NEVER use
  // `modelsFetcher.url` — that points at a catalog host (e.g. models.dev),
  // not the provider, so an outage there would read as healthy. Probe the
  // provider's own HTTP host only. Non-HTTP schemes (auggie://cli/stdio) have
  // no network target → caller marks them unconfigured.
  const entry = REGISTRY_BY_ID.get(connection.provider);
  const cfg = PROVIDERS[connection.provider];
  const candidates = [
    entry?.validateUrl,
    cfg?.validateUrl,
    connection.providerSpecificData?.baseUrl,
    cfg?.baseUrl,
  ].filter(Boolean).map(String);
  for (const c of candidates) {
    if (/^https?:\/\//i.test(c)) {
      // Probe the origin — chat-only baseUrls (…/openai/chat) would 404/405 on
      // the path, but the origin answers and proves reachability.
      try {
        return new URL(c).origin;
      } catch {
        return c;
      }
    }
  }
  return null;
}

async function probeRegistryNoAuth(connection, effectiveProxy, fetcher) {
  // Real reachability check for registry noAuth transports. The generic
  // `probeRegistryProvider` returns `{valid:true}` for `accepts:"always"`
  // (mimo-free, pollinations, …) WITHOUT any network I/O — that would make the
  // monitor report "up" for providers that are actually down. Probe the
  // provider host directly, guarded + proxy-aware.
  const url = httpProbeTarget(connection);
  if (!url) {
    // Local CLI / stdio transport with no HTTP endpoint: nothing to probe over
    // the network. Surface an explicit unconfigured signal — the monitor maps
    // it to "unconfigured", NOT healthy.
    return { valid: false, status: null, unconfigured: true, error: "no HTTP transport to probe" };
  }
  try {
    assertOutboundUrlAllowed(url);
    const headers = connection.apiKey ? { Authorization: `Bearer ${connection.apiKey}` } : {};
    // Any HTTP response from the host proves reachability — including 404/405
    // on the origin. Only network failure / timeout / 5xx / SSRF-block = down.
    const res = await proxyAware(url, withTimeout({ method: "GET", headers }), effectiveProxy, fetcher);
    if (res.status >= 500) return { valid: false, status: res.status, error: `HTTP ${res.status}` };
    return { valid: true, status: res.status };
  } catch (err) {
    if (err instanceof OutboundUrlGuardError) return { valid: false, status: null, blocked: true, error: err.message };
    return { valid: false, status: null, error: err.message };
  }
}

async function probeRegistry(connection, fetcher, effectiveProxy) {
  const { probeRegistryProvider } = await import("@/app/api/providers/providerProbe");
  return probeRegistryProvider(
    connection.provider,
    connection.apiKey,
    (url, opts) => proxyAware(url, { ...opts, redirect: "manual" }, effectiveProxy, fetcher ?? fetch),
    connection.providerSpecificData || {}
  );
}

/**
 * Probe one connection. Never throws. No DB writes.
 *
 * @param {object} connection  row from getProviderConnections()
 * @param {{ fetcher?: typeof fetch, proxyConfig?: object }} [opts]
 * @returns {Promise<{valid:boolean,status:number|null,blocked?:boolean,error:string|null}>}
 */
export async function probeConnectionHealth(connection, opts = {}) {
  const fetcher = opts.fetcher;
  if (!connection) return { valid: false, status: null, error: "no connection" };

  // Health probes must use the SAME credential the live chat path uses. OAuth
  // connections (claude, codex, gemini-cli, …) store their bearer token in
  // `accessToken`, not `apiKey`; probing with the (absent) apiKey 401s and
  // reports a healthy, actively-serving account as "down". Fall back to the
  // OAuth token so every probe path (which reads `connection.apiKey`) sends the
  // real credential. Never overwrite an existing apiKey.
  if (!connection.apiKey && connection.accessToken) {
    connection = { ...connection, apiKey: connection.accessToken };
  }

  let effectiveProxy = opts.proxyConfig;
  if (effectiveProxy === undefined) {
    try {
      effectiveProxy = await resolveConnectionProxyConfig(connection.providerSpecificData || {});
    } catch {
      effectiveProxy = null;
    }
  }

  const proxied = !!(effectiveProxy?.connectionProxyEnabled || effectiveProxy?.vercelRelayUrl);
  const safe = (p) => p.catch((err) => ({ valid: false, status: null, error: err?.message || "probe failed" }));

  try {
    // Custom compatible providers — explicit baseUrl probes (proxy-aware + guarded).
    if (isOpenAICompatibleProvider(connection.provider)) {
      return await safe(probeOpenAICompatible(connection, effectiveProxy, fetcher));
    }
    if (isAnthropicCompatibleProvider(connection.provider)) {
      return await safe(probeAnthropicCompatible(connection, effectiveProxy, fetcher));
    }

    // Local OpenAI-compatible providers (lm-studio, vllm, …) — only when a
    // proxy is NOT forcing a specific egress; otherwise the registry probe's
    // own URL selection is more accurate.
    if (!proxied && LOCAL_OPENAI_COMPATIBLE_PROVIDERS.has(connection.provider)) {
      const local = await safe(probeLocalOpenAI(connection, effectiveProxy, fetcher));
      if (local) return local;
    }

    // Registry providers. noAuth transports get an explicit reachability probe
    // so they can never auto-pass via `accepts:"always"`. `noAuth` lives on the
    // registry entry, NOT on PROVIDERS (buildTransport drops registry fields).
    const cfg = PROVIDERS[connection.provider];
    if (isRegistryNoAuth(connection.provider)) {
      const noAuthResult = await safe(probeRegistryNoAuth(connection, effectiveProxy, fetcher));
      if (noAuthResult) return noAuthResult;
    }

    // When a proxy is configured the registry probe can't
    // route through it, so fall back to a guarded `${baseUrl}/models` probe that
    // IS proxy-aware rather than bypassing the saved egress.
    if (proxied) {
      const baseUrl = connection.providerSpecificData?.baseUrl || cfg?.validateUrl || cfg?.baseUrl;
      if (baseUrl) {
        const url = String(baseUrl).replace(/\/chat\/completions\/?$/, "").replace(/\/+$/, "");
        const modelsUrl = url.endsWith("/models") ? url : `${url}/models`;
        try {
          assertOutboundUrlAllowed(modelsUrl);
          const headers = connection.apiKey ? { Authorization: `Bearer ${connection.apiKey}` } : {};
          const res = await proxyAware(modelsUrl, withTimeout({ headers }), effectiveProxy, fetcher);
          if (res.ok) return { valid: true, status: res.status };
          if (AUTH_FAILURE_STATUSES.has(res.status)) return { valid: false, status: res.status, error: "Invalid API key" };
          return { valid: false, status: res.status, error: `HTTP ${res.status}` };
        } catch (err) {
          if (err instanceof OutboundUrlGuardError) return { valid: false, status: null, blocked: true, error: err.message };
          // fall through to registry probe as last resort
        }
      }
    }

    const result = await probeRegistry(connection, fetcher, effectiveProxy);
    if (!result) return { valid: false, status: null, error: "no probe for provider" };
    return result;
  } catch (err) {
    return { valid: false, status: null, error: sanitizeErrorMessage(err?.message || "probe failed") };
  }
}

export { sanitizeErrorMessage, AUTH_FAILURE_STATUSES };

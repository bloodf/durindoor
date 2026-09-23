import { getDefaultModel, PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";
import { PROVIDERS } from "open-sse/config/providers.js";
import { normalizeAccountIdPlaceholder } from "open-sse/executors/default.js";
import { openaiToCommandCodeRequest } from "open-sse/translator/request/openai-to-commandcode.js";
import { assertOutboundUrlAllowed, getProviderValidationGuard, guardedProbeFetch, OutboundUrlGuardError } from "open-sse/utils/outboundUrlGuard.js";
import { buildNextAuthSessionCookie, extractKimiJwt, kimiWebOrigin, KIMI_WEB_DISCOVERY_HEADERS } from "@/lib/providers/webCookieAuth.js";
import { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { BEDROCK_CREDENTIAL_MODE } from "open-sse/config/bedrock.js";
import { BedrockExecutor, statusFromError as bedrockErrorStatus } from "open-sse/executors/bedrock.js";
import { detectBedrockCredentialMode } from "open-sse/shared/awsCredentials.js";

const AUTH_FAILURE_STATUSES = new Set([401, 403]);
const CHAT_PROBE_ACCEPT_STATUSES = new Set([400, 422, 429]);

// Chat formats whose registry `validateUrl` does not actually reject a bad
// key. See the comment above the validateUrl branch in
// buildRegistryProviderProbe for why "ollama" is here.
const VALIDATE_URL_UNVERIFIED_FORMATS = new Set(["ollama"]);

// Specialty validators run BEFORE the generic registry probe for providers
// whose registry entry has no chat transport (`transport: null`) and so cannot
// be probed through buildRegistryProviderProbe. Keyed by provider id.
const SPECIALTY_VALIDATORS = {
  // Devin cloud-agent (Cognition) — GET /v1/sessions with Bearer auth
  // (docs.devin.ai/api-reference/sessions/list-sessions). Distinct from the
  // "devin-cli" LLM provider (ACP stdio), which has its own executor.
  // Ported from OmniRoute #6894 (diegosouzapw#6142, parity with `jules`).
  devin: validateDevinCloudAgentProvider,
  bedrock: validateBedrockSignedProvider,
  "chatgpt-web": validateChatgptWebSession,
};

const CHATGPT_SESSION_URL = "https://chatgpt.com/api/auth/session";
const CHATGPT_WEB_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

/**
 * ChatGPT Web — exchange the NextAuth session cookie for an access token at
 * chatgpt.com/api/auth/session, the same call the web app makes. A logged-in
 * session answers 200 with `accessToken`; an expired or incomplete one (e.g. a
 * missing `.1` chunk) answers 200 with `{}`. Chunked cookies are sent as
 * separate `__Secure-next-auth.session-token.N` cookies, never concatenated.
 */
export async function validateChatgptWebSession({ apiKey, fetcher = fetch }) {
  const cookie = buildNextAuthSessionCookie(apiKey);
  if (!cookie) {
    return { valid: false, status: null, error: "No __Secure-next-auth.session-token cookie found in the pasted value" };
  }
  let response;
  try {
    response = await guardedProbeFetch(
      CHATGPT_SESSION_URL,
      {
        method: "GET",
        headers: { Accept: "application/json", "User-Agent": CHATGPT_WEB_USER_AGENT, Cookie: cookie },
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
      },
      getProviderValidationGuard(),
      fetcher,
    );
  } catch (err) {
    if (err instanceof OutboundUrlGuardError) {
      return { valid: false, status: null, blocked: true, error: err.message };
    }
    return { valid: false, status: null, error: "Provider unavailable - network request failed" };
  }
  if (!response.ok) {
    return { valid: false, status: response.status, error: `chatgpt.com rejected the session cookie (HTTP ${response.status})` };
  }
  const data = await response.json().catch(() => null);
  if (data?.accessToken) return { valid: true, status: response.status };
  return {
    valid: false,
    status: response.status,
    error: "Session expired or incomplete - paste every __Secure-next-auth.session-token chunk (.0, .1, ...)",
  };
}

/**
 * Devin cloud-agent (Cognition) — list one session with Bearer auth; a 2xx
 * proves the service-user token is accepted, 401/403 rejects it. Uses the
 * SSRF-guarded fetch helper with `redirect: "manual"` so a 3xx cannot bypass the
 * guard (#6542), preserving `blocked: true` for guard rejections while ordinary
 * network errors remain unavailable. The optional `fetcher` override lets callers
 * (health monitor, connection tests) inject a proxy-aware transport.
 */
export async function validateDevinCloudAgentProvider({ apiKey, fetcher = fetch }) {
  const url = "https://api.devin.ai/v1/sessions?limit=1";
  let response;
  try {
    response = await guardedProbeFetch(
      url,
      { method: "GET", headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(8000) },
      getProviderValidationGuard(),
      fetcher,
    );
  } catch (err) {
    if (err instanceof OutboundUrlGuardError) {
      return { valid: false, status: null, blocked: true, error: err.message };
    }
    return { valid: false, status: null, error: "Provider unavailable - network request failed" };
  }
  if (AUTH_FAILURE_STATUSES.has(response.status)) {
    return { valid: false, status: response.status, error: "Invalid API key" };
  }
  if (response.ok) return { valid: true, status: response.status };
  return { valid: false, status: response.status, error: `Provider validation failed (HTTP ${response.status ?? "unknown"})` };
}

/**
 * Bedrock with static AWS keys or a local AWS profile. The generic probe would send `apiKey` as a
 * bearer token, and in these modes that is the IAM secret access key (or nothing, for a profile).
 * Instead this signs a Converse call with an empty message list through the same client the
 * executor builds: AWS checks the signature before the body, so a ValidationException proves the
 * credentials work without running any inference. Returns null for a Bedrock API key connection
 * so it keeps the generic bearer probe.
 *
 * The SDK client does not route through the connection proxy; neither does the executor.
 */
export async function validateBedrockSignedProvider({ apiKey, providerSpecificData, sessionToken, clientFactory = null }) {
  const credentials = { apiKey, sessionToken, providerSpecificData };
  if (detectBedrockCredentialMode(credentials) === BEDROCK_CREDENTIAL_MODE.API_KEY) return null;
  try {
    const client = new BedrockExecutor(clientFactory).createClient(credentials);
    await client.send(
      new ConverseCommand({ modelId: getDefaultModel("bedrock"), messages: [] }),
      { abortSignal: AbortSignal.timeout(10000) },
    );
    return { valid: true, status: 200 };
  } catch (error) {
    const status = bedrockErrorStatus(error);
    // AccessDeniedException comes after AWS accepted the signature: the key is real and IAM
    // denies this model (not enabled, or a policy scoped to other models). Bad keys, bad
    // signatures and expired tokens arrive as other 403 names.
    if (error?.name === "AccessDeniedException") return { valid: true, status };
    if (AUTH_FAILURE_STATUSES.has(status)) {
      // Our own configuration errors (e.g. a temporary key with no session token) say what to fix
      // and never contain key material; everything else stays generic.
      const message = error?.name === "InvalidCredentials" ? error.message : "Invalid AWS credentials";
      return { valid: false, status, error: message };
    }
    if (CHAT_PROBE_ACCEPT_STATUSES.has(status)) return { valid: true, status };
    return { valid: false, status, error: getChatProbeError(status) };
  }
}

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

  // A registry-declared validateUrl is a dedicated key-check endpoint (the same
  // lookup providers/validate/route.js performs), independent of the chat
  // transport format. Honor it before the openai-only gate below so formats
  // like "openai-responses" (e.g. perplexity-agent) get a working connection
  // test instead of falling through to "Provider test not supported". The
  // chat-body fallback only makes sense for the plain openai format.
  //
  // Exception: VALIDATE_URL_UNVERIFIED_FORMATS. A format's validateUrl is only
  // safe to trust with accepts: "ok" if that endpoint actually rejects a bad
  // key. Ollama's `validateUrl` (https://ollama.com/api/tags) is a public model
  // listing that returns 200 with no Authorization header and with a bad
  // bearer, so honoring it here would mark any bad Ollama Cloud key "valid"
  // (fail-open). Formats in this set fall through to the pre-existing
  // format-specific probes below (or `null`, unprobed) instead.
  if (cfg.validateUrl && !VALIDATE_URL_UNVERIFIED_FORMATS.has(cfg.format)) {
    const probe = {
      url: cfg.validateUrl,
      options: { headers, signal: AbortSignal.timeout(8000) },
      accepts: "ok",
    };
    if (cfg.format === "openai") {
      probe.fallback = {
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
      };
    }
    return probe;
  }

  if (cfg.format !== "openai") return null;

  // Kimi Web (www.kimi.com) is a token-authed Connect-RPC provider. The user
  // pastes the localStorage token JSON (or a legacy Cookie header); only the
  // extracted access token reaches the wire — never the raw blob. Probe the
  // same models endpoint the dashboard discovery route uses: it answers 200
  // without auth, but 401 for a bad Bearer, so a valid token yields 200.
  if (provider === "kimi-web") {
    const jwt = extractKimiJwt(apiKey);
    if (!jwt) return null;
    const origin = kimiWebOrigin(apiKey);
    return {
      url: `${origin}/apiv2/kimi.gateway.config.v1.ConfigService/GetAvailableModels`,
      options: {
        method: "POST",
        headers: {
          ...KIMI_WEB_DISCOVERY_HEADERS,
          Origin: origin,
          Referer: `${origin}/`,
          Authorization: `Bearer ${jwt}`,
        },
        body: "{}",
        signal: AbortSignal.timeout(8000),
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

export async function probeRegistryProvider(provider, apiKey, fetcher = fetch, providerSpecificData = {}, { sessionToken } = {}) {
  const specialty = SPECIALTY_VALIDATORS[provider];
  // A specialty validator returning null hands the connection back to the generic probe.
  const specialtyResult = specialty ? await specialty({ apiKey, fetcher, providerSpecificData, sessionToken }) : null;
  if (specialtyResult) return specialtyResult;
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

  const blockedResult = (err) => ({
    valid: false,
    status: null,
    error: err?.message || "Provider URL blocked by SSRF guard",
    blocked: true,
  });
  let res;
  try {
    res = await guardedProbeFetch(probe.url, probe.options, guard, fetcher);
  } catch (err) {
    if (err instanceof OutboundUrlGuardError) return blockedResult(err);
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

  try {
    const fallbackRes = await guardedProbeFetch(probe.fallback.url, probe.fallback.options, guard, fetcher);
    return { valid: !AUTH_FAILURE_STATUSES.has(fallbackRes.status), status: fallbackRes.status };
  } catch (err) {
    if (err instanceof OutboundUrlGuardError) return blockedResult(err);
    throw err;
  }
}

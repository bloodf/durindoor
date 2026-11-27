import { FILTERS } from "../../suggested-models/filters.js";
import { fetchOpenCodeServerModels } from "open-sse/services/opencodeServer.js";
import { refreshOpenferenceToken } from "open-sse/services/openferenceAuth.js";
import geminiInteractions, { GEMINI_MODELS_URL } from "open-sse/providers/registry/gemini-interactions.js";
import mlx from "open-sse/providers/registry/mlx.js";
import { refreshGoogleToken, updateProviderCredentials } from "@/sse/services/tokenRefresh";
import { KIMI_WEB_DISCOVERY_HEADERS } from "@/lib/providers/webCookieAuth";
import { resolveKimiTokens } from "open-sse/executors/kimi-web.js";
import { resolveOllamaLocalHost } from "open-sse/config/providers.js";
import { discoverOllamaCatalog } from "open-sse/services/ollamaCatalog.js";
import { normalizeVeniceModel } from "open-sse/services/liveModelLimits.js";
import { getModelsByProviderId } from "open-sse/config/providerModels.js";
import { discoverRenderHourModels } from "open-sse/services/renderhour/media.js";
import { readAdobeFireflyCredential } from "open-sse/services/adobeFireflyApi/auth.js";
import { resolveKiroModels } from "open-sse/services/kiroModels.js";
import { resolveCopilotModels } from "open-sse/services/copilotModels.js";
import { buildCopilotEndpointContract, readCopilotEndpointContract } from "open-sse/services/copilotEndpointContract.js";
import { updateProviderConnection } from "@/lib/localDb";
import { resolveGheCopilotApiBase } from "open-sse/config/gheCopilot.js";
import { GITHUB_COPILOT } from "open-sse/config/appConstants.js";
import { resolveKimchiModels } from "open-sse/services/kimchiModels.js";
import { resolveQoderModels } from "open-sse/services/qoderModels.js";
import { resolveCommandCodeModels } from "open-sse/services/commandcodeModels.js";
import { META_MODEL_API_MODELS_URL } from "open-sse/config/museCode.js";
import {
  ANTIGRAVITY_CATALOG_URL,
  buildAntigravityCatalogBody,
  classifyAntigravityCatalogStatus,
  parseAntigravityCatalogModels
} from "open-sse/services/antigravityCatalog.js";
import { resolveCursorModels } from "open-sse/services/cursorModels.js";
import { discoverCursorApiModels, isCursorApiDispatchEnabled } from "open-sse/executors/cursor-api.js";
import { discoverDevinDesktopModels, isDevinDesktopDispatchEnabled } from "open-sse/executors/devin-desktop.js";
import { modelsConfig as workbuddyModelsConfig } from "open-sse/providers/registry/workbuddy.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
import { guardedProbeFetch, getProviderValidationGuard } from "open-sse/utils/outboundUrlGuard.js";
import { isOpenRouterFreeModel } from "open-sse/services/openrouterCatalog.js";
import { ANTHROPIC_API_VERSION, ANTIGRAVITY_IDE_USER_AGENT, ANTIGRAVITY_IDE_VERSION, ANTIGRAVITY_OAUTH_CLIENT, CLAUDE_CLI_SPOOF_HEADERS } from "open-sse/providers/shared.js";
import { sanitizeErrorMessage } from "open-sse/utils/error.js";
import { antigravityClientBindingBlocks, antigravityClientBindingError } from "open-sse/services/antigravityClientBinding.js";
import {
  discoverOrcaRouterModels,
  resolveApiBase,
  ORCAROUTER_CAPABILITIES,
  ORCAROUTER_MODALITIES,
  ORCAROUTER_ID } from
"open-sse/providers/orcarouterCatalog.js";
import { discoverGisooModels } from "open-sse/providers/gisooCatalog.js";
import { discoverCloudflareModels } from "open-sse/services/cloudflareModels.js";
import { chatPlaygroundCatalog } from "open-sse/executors/chatplayground.js";
import { discoverInnerAiWebModels } from "open-sse/executors/inner-ai-web.js";
import { discoverVeniceWebModels } from "open-sse/executors/venice-web.js";
import { discoverPoeWebModels } from "open-sse/providers/registry/poe-web.js";
import { discoverV0Models } from "open-sse/providers/registry/v0-vercel-web.js";
import { isObject, isString } from "../../../../../shared/utils/typeChecks.js";
import { CODEX_CLI_USER_AGENT, CODEX_CLI_VERSION } from "open-sse/config/appConstants.js";
import { meetsMinimalCodexClientVersion } from "open-sse/config/codexClientVersion.js";
import { withCodexReviewModels } from "open-sse/providers/models/helpers.js";
import {
  DOTHOOSH_ANTHROPIC_MODELS_URL,
  DOTHOOSH_OPENAI_MODELS_URL,
  dotHooshListingHeaders,
  mergeDotHooshListings
} from "open-sse/providers/dothooshCatalog.js";

const KIMI_WEB_MODELS_PATH = "/apiv2/kimi.gateway.config.v1.ConfigService/GetAvailableModels";

/**
 * Kimi Web discovery goes to the deployment (www.kimi.com / www.kimi.ai) the
 * pasted session came from; see `resolveKimiTokens`.
 * @param {object} connection
 * @returns {string}
 */
export function resolveKimiWebModelsUrl(connection) {
  return `${resolveKimiTokens(connection).origin}${KIMI_WEB_MODELS_PATH}`;
}

/**
 * OrcaRouter — resolve one capability's catalog for this account.
 *
 * Keeps the API key server-side: the browser only ever receives model metadata.
 * `capability` is read from the request query, so a text picker and a multimodal
 * picker can ask for different, already-filtered lists. `modality` narrows that
 * list further for entry points that actually upload a non-text part.
 *
 * The catalog origin comes only from operator configuration (`ORCA_API_BASE_URL`
 * / `ORCA_BASE_URL`, else the public relay). A connection's
 * `providerSpecificData.baseUrl` is client-writable through the providers API,
 * so honouring it would let any management caller send the stored key as a
 * Bearer token to a host of their choosing.
 *
 * @param {object} connection - The stored provider connection
 * @param {object|null} proxyOptions - The connection's resolved proxy route
 * @param {string|null} requestUrl - The incoming request URL, for its query string
 * @returns {Promise<{models?: Array<object>, source?: string, degraded?: boolean, warning?: string, error?: string, status?: number}>}
 */
async function resolveOrcaRouterModels(connection, proxyOptions, requestUrl) {
  const params = new URL(requestUrl || "http://localhost/").searchParams;
  const capability = params.get("capability") || "chat";
  if (!ORCAROUTER_CAPABILITIES.includes(capability)) {
    return { error: `Unsupported capability: ${capability}`, status: 400 };
  }
  // Modality is enforced server-side so the browser never has to know which
  // models declare, say, image input — an undeclared capability fails closed.
  const modality = params.get("modality") || null;
  if (modality && !ORCAROUTER_MODALITIES.includes(modality)) {
    return { error: `Unsupported modality: ${modality}`, status: 400 };
  }

  const apiKey = connection.accessToken || connection.apiKey;
  const result = await discoverOrcaRouterModels({
    apiKey,
    apiBase: resolveApiBase(process.env),
    capability,
    modality,
    fetchImpl: (url, init) => proxyAwareFetch(url, init, proxyOptions)
  });

  const models = result.models.map((m) => {
    const entry = {
      id: m.id,
      name: m.name,
      inputModalities: m.inputModalities,
      endpointTypes: m.endpointTypes,
      reasoning: m.reasoning
    };
    if (m.contextLength !== null) entry.contextLength = m.contextLength;
    // Defensive: a catalog entry only carries effort levels when the upstream
    // record declared them, so never assume the array exists.
    if (m.reasoningEfforts?.length) entry.reasoningEfforts = m.reasoningEfforts;
    return entry;
  });

  const resolved = {
    models,
    // `source` lets the UI label a degraded catalog instead of silently showing
    // the cold-start seed as if it were live discovery.
    source: result.source,
    degraded: result.degraded
  };
  if (result.error) resolved.warning = `catalog fallback: ${result.error}`;
  return resolved;
}

const GEMINI_CLI_MODELS_URL = "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels";

export const parseOpenAIStyleModels = (data) => {
  if (Array.isArray(data)) return data;
  return data?.data || data?.models || data?.results || [];
};

// Mistral keeps retired models in /v1/models and dates them with `deprecation`.
// A missing, unreadable or future date keeps the card (OmniRoute #20087).
const isRetiredModelCard = (card) => Date.parse(card?.deprecation) <= Date.now();

export const parseMistralModels = (data) =>
  parseOpenAIStyleModels(data).filter((card) => !isRetiredModelCard(card));

export const parseGeminiCliModels = (data) => {
  if (Array.isArray(data?.models)) {
    return data.models.
    map((item) => {
      const id = item?.id || item?.model || item?.name;
      if (!id) return null;
      return { id, name: item?.displayName || item?.name || id };
    }).
    filter(Boolean);
  }

  if (data?.models && isObject(data.models)) {
    return Object.entries(data.models).
    filter(([, info]) => !info?.isInternal).
    map(([id, info]) => ({
      id,
      name: info?.displayName || info?.name || id
    }));
  }

  return [];
};

export const parseCodexModels = (data) => withCodexReviewModels(
  parseOpenAIStyleModels(data).filter((model) => model?.supported_in_api !== false && model?.visibility !== "hide" && meetsMinimalCodexClientVersion(model?.minimal_client_version)).flatMap((model) => {
    const id = model?.id || model?.slug || model?.model || model?.name;
    if (!id) return [];
    const name = model?.display_name || model?.displayName || model?.name || id;
    return [{ ...model, id, name }];
  })
);

export const createOpenAIModelsConfig = (url) => ({
  url,
  method: "GET",
  headers: { "Content-Type": "application/json" },
  authHeader: "Authorization",
  authPrefix: "Bearer ",
  parseResponse: parseOpenAIStyleModels
});

/**
 * Read one DotHoosh listing.
 *
 * The provider publishes two listings: the OpenAI path (/v1/models) and the
 * Anthropic path (/anthropic/v1/models). A model is served on the paths it is
 * verified for, so a model that only the Anthropic path lists never appears
 * in the OpenAI listing. Both are read and merged.
 *
 * The key only ever travels to the provider host: the OpenAI listing takes
 * the bearer scheme, the Anthropic listing takes x-api-key only (the
 * provider rejects a request that carries both auth headers).
 *
 * @param {string} url - listing URL on the provider host
 * @param {"openai"|"anthropic"} listing - which listing is being read
 * @param {string} apiKey - the connection's key
 * @param {object|null} proxyOptions
 * @returns {Promise<{ rows: object[], error?: string, status?: number }>}
 */
export async function fetchDotHooshListing(url, listing, apiKey, proxyOptions = null) {
  try {
    const response = await proxyAwareFetch(url, {
      method: "GET",
      headers: dotHooshListingHeaders(listing, apiKey),
      cache: "no-store",
      signal: AbortSignal.timeout(15000)
    }, proxyOptions);
    if (!response.ok) {
      const text = await response.text();
      return {
        rows: [],
        error: sanitizeErrorMessage(text || response.statusText),
        status: response.status
      };
    }
    const body = await response.json();
    const rows = Array.isArray(body?.data) ? body.data : (Array.isArray(body) ? body : []);
    return { rows };
  } catch (error) {
    return { rows: [], error: sanitizeErrorMessage(error?.message), status: 502 };
  }
}

export const resolveQwenModelsUrl = (connection) => {
  const fallback = "https://portal.qwen.ai/v1/models";
  const raw = connection?.providerSpecificData?.resourceUrl;
  if (!raw || !isString(raw)) return fallback;
  const value = raw.trim();
  if (!value) return fallback;
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return `${value.replace(/\/$/, "")}/models`;
  }
  return `https://${value.replace(/\/$/, "")}/v1/models`;
};

/**
 * Media job providers registered for #2034 (1127). Neither publishes a model
 * list endpoint the gateway can read, so both answer their pinned lists after
 * checking only the selected connection's credential shape. Nothing is sent.
 */
function renderHourDiscovery(connection) {
  const result = discoverRenderHourModels(connection);
  if (!result.success) return { error: result.error, status: result.status };
  return { models: result.data.map(({ id, name, kind }) => ({ id, name, kind })), source: "local_catalog" };
}

function adobeFireflyApiDiscovery(connection) {
  try {
    readAdobeFireflyCredential(connection);
  } catch (error) {
    return { error: error.message, status: Number.isInteger(error?.status) ? error.status : 401 };
  }
  return { models: getModelsByProviderId("adobe-firefly-api").map(({ id, name, kind }) => ({ id, name: name || id, kind })), source: "local_catalog" };
}

export const getStaticProviderModels = (providerId) =>
getModelsByProviderId(providerId).map((model) => ({
  ...model,
  id: model.id,
  name: model.name || model.id
}));

export const buildOAuthResolver = ({ refreshFn, fetchFn, parseFn, errorLabel, refreshBlockedError = null }) =>
async (connection, proxyOptions = null) => {
  const { accessToken, refreshToken } = connection;
  if (!accessToken) {
    return { error: "No valid token found", status: 401 };
  }
  let warning;
  try {
    let response = await fetchFn(accessToken, connection, proxyOptions);
    if (!response.ok && (response.status === 401 || response.status === 403) && refreshToken) {
      // Preflight: report the refusal without refreshing or writing anything.
      const blocked = refreshBlockedError?.(connection);
      if (blocked) return { error: blocked.message, status: blocked.status, category: blocked.category };
      const refreshed = await refreshFn(connection, proxyOptions);
      if (refreshed?.accessToken) {
        await updateProviderCredentials(connection.id, {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken || refreshToken,
          expiresIn: refreshed.expiresIn
        });
        connection.accessToken = refreshed.accessToken;
        if (refreshed.refreshToken) connection.refreshToken = refreshed.refreshToken;
        response = await fetchFn(refreshed.accessToken, connection, proxyOptions);
      }
    }
    if (response.ok) {
      const data = await response.json();
      const models = parseFn(data);
      if (models.length > 0) return { models };
    } else {
      const errorText = await response.text();
      const safeError = sanitizeErrorMessage(errorText);
      warning = `${errorLabel}: ${response.status} ${safeError}`;
      console.log(`${errorLabel} (falling back to static):`, safeError);
    }
  } catch (error) {
    const safeError = sanitizeErrorMessage(error?.message);
    warning = `${errorLabel}: ${safeError}`;
    console.log(`${errorLabel} (falling back to static):`, safeError);
  }
  return { models: [], warning };
};

// Qoder shares one resolver across intl (qoder) and CN (qoder-cn); the
// credentials carry the connection's provider id so qoderModels picks the
// right region's catalog endpoint, and the returned model ids keep the
// provider prefix the chat router expects.
function buildQoderModelsResolver(providerId) {
  return {
    customResolver: async (connection, proxyOptions = null) => {
      const credentials = {
        provider: providerId,
        accessToken: connection.accessToken,
        refreshToken: connection.refreshToken,
        email: connection.email,
        displayName: connection.displayName,
        providerSpecificData: connection.providerSpecificData || {}
      };
      let warning;
      try {
        const result = await resolveQoderModels(credentials, { forceRefresh: true, proxyOptions });
        if (result?.models?.length) {
          return {
            models: result.models.map((m) => ({
              id: `${providerId}/${m.id}`,
              name: m.name,
              contextLength: m.contextLength,
              isVL: m.isVL,
              isReasoning: m.isReasoning,
              maxOutputTokens: m.maxOutputTokens,
              description: m.description
            }))
          };
        }
        warning = "Qoder returned no models; falling back to static catalog.";
      } catch (error) {
        const safeError = sanitizeErrorMessage(error?.message);
        warning = `Failed to fetch Qoder models: ${safeError}`;
        console.log("Failed to fetch Qoder models dynamically, falling back to static:", safeError);
      }
      return { models: [], warning };
    }
  };
}

/**
 * Claude connections normally hold an OAuth token, which Anthropic rejects as
 * `x-api-key`. OAuth tokens go out as a Bearer with the `oauth-2025-04-20` beta
 * and the spoofed Claude Code User-Agent; a real API key keeps `x-api-key`.
 * @param {string} token
 * @returns {Record<string, string>}
 */
export function buildClaudeModelsHeaders(token) {
  const headers = { "Anthropic-Version": ANTHROPIC_API_VERSION, "Content-Type": "application/json" };
  if (token.startsWith("sk-ant-api")) return { ...headers, "x-api-key": token };
  return {
    ...headers,
    Authorization: `Bearer ${token}`,
    "Anthropic-Beta": "oauth-2025-04-20",
    "User-Agent": CLAUDE_CLI_SPOOF_HEADERS["User-Agent"]
  };
}

// The catalog includes media and embedding models; only advertise chat endpoints.
export const parseEmpirioLabsChatModels = (data) => {
  if (!Array.isArray(data?.data)) return [];
  return data.data.filter((model) => isString(model?.id) && model.id &&
    Array.isArray(model.supported_endpoints) && model.supported_endpoints.includes("POST /v1/chat/completions"))
    .map((model) => {
      const result = { id: model.id, name: model.display_name || model.id };
      if (model.context_window) result.contextLength = model.context_window;
      if (model.max_output_tokens) result.outputTokenLimit = model.max_output_tokens;
      if (Array.isArray(model.input_modalities) && model.input_modalities.includes("image")) result.supportsVision = true;
      return result;
    });
};

/** Retain upstream vendor-qualified IDs and exclude non-chat-only rows. */
export const parseLlmtrModels = (data) => parseOpenAIStyleModels(data).filter((model) =>
  model && isString(model.id) &&
  (!Array.isArray(model.supported_operations) || model.supported_operations.length === 0 || model.supported_operations.includes("CHAT_COMPLETIONS"))
);

/**
 * Attach Copilot's endpoint contract to one catalog row.
 *
 * The contract states which of Copilot's existing routes serves the model. A
 * row that declares no endpoint keeps none, so the executor falls back to its
 * current behavior for it.
 */
export function withCopilotEndpointContract(row) {
  if (!isObject(row) || !isString(row.id)) return row;
  const contract = readCopilotEndpointContract(row, row.id);
  if (!contract.supportedEndpoints?.length) return row;
  const enriched = { ...row, supportedEndpoints: contract.supportedEndpoints };
  if (contract.targetFormat) enriched.targetFormat = contract.targetFormat;
  return enriched;
}

/** Compare two stored contracts regardless of model order. */
function sameCopilotEndpointContract(left, right) {
  const normalize = (value) => {
    if (!isObject(value) || !Array.isArray(value.models)) return null;
    return JSON.stringify({
      version: value.version,
      models: [...value.models].sort((a, b) => String(a?.id).localeCompare(String(b?.id)))
    });
  };
  return normalize(left) === normalize(right);
}

/**
 * Persist the Copilot endpoint contract discovered for a connection.
 *
 * The contract is a per-account fact: it states which of Copilot's existing
 * routes serves a model for THIS account. It is stored on the connection so
 * the executor can read it without another catalog fetch, and so the account
 * that serves a request stays the account that discovered its route.
 *
 * The model list is an array, so a refreshed catalog replaces the stored one
 * instead of merging into it and keeping models Copilot stopped serving. The
 * write is skipped when the stored contract already matches.
 */
export async function persistCopilotEndpointContract(connection, rows) {
  if (!connection?.id) return null;
  const contract = buildCopilotEndpointContract(rows);
  const stored = connection.providerSpecificData?.copilotEndpointContract;
  if (sameCopilotEndpointContract(stored, contract)) return contract;
  try {
    // Deep merge: the contract must not disturb the stored Copilot token or
    // the enterprise host.
    await updateProviderConnection(connection.id, {
      providerSpecificData: { copilotEndpointContract: contract }
    });
  } catch (error) {
    console.warn("Copilot endpoint contract not stored:", sanitizeErrorMessage(error?.message || error));
  }
  return contract;
}

/**
 * Account-scoped discovery for a web-session executor: only the selected
 * connection's stored cookie is read, through its own proxy route. The executor
 * errors carry gateway-authored messages, never upstream text.
 */
function webSessionDiscovery(discover, label) {
  return async (connection, proxyOptions = null) => {
    if (!connection.apiKey) return { error: "No valid token found", status: 401 };
    try {
      return { models: await discover({ credentials: { apiKey: connection.apiKey }, proxyOptions }) };
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 502;
      return { error: sanitizeErrorMessage(error?.message || `${label} model discovery failed`), status };
    }
  };
}

export const PROVIDER_MODELS_CONFIG = {
  // Web sessions registered for #2034 (1127). Inner.ai Web reads the account's own
  // catalog; Venice Web checks the session with one read-only Clerk GET and answers
  // its pinned list. Poe Web and v0 Web publish no list endpoint for the session, so
  // their pinned static lists answer without sending the cookie anywhere.
  "inner-ai-web": { customResolver: webSessionDiscovery(discoverInnerAiWebModels, "Inner.ai Web") },
  "venice-web": { customResolver: webSessionDiscovery(discoverVeniceWebModels, "Venice Web") },
  "poe-web": { customResolver: () => ({ models: discoverPoeWebModels(), source: "local_catalog" }) },
  renderhour: { customResolver: renderHourDiscovery },
  "adobe-firefly-api": { customResolver: adobeFireflyApiDiscovery },
  "v0-vercel-web": { customResolver: () => ({ models: discoverV0Models(), source: "local_catalog" }) },
  "cloudflare-ai": {
    customResolver: (connection, proxyOptions = null) => discoverCloudflareModels(connection, {
      fetchImpl: (url, init) => proxyAwareFetch(url, init, proxyOptions),
      staticModels: getStaticProviderModels("cloudflare-ai")
    })
  },
  // ChatPlayground's catalog is read with the session Cookie header and lists each chat model by slug.
  chatplayground: {
    url: "https://web.chatplayground.ai/api/models", method: "GET", headers: {},
    buildHeaders: (_token, connection) => ({ Cookie: connection.apiKey }),
    parseResponse: chatPlaygroundCatalog,
  },
  empiriolabs: { ...createOpenAIModelsConfig("https://api.empiriolabs.ai/v1/models?available=true"), parseResponse: parseEmpirioLabsChatModels },
  "opencode-server": { customResolver: (connection) => fetchOpenCodeServerModels(connection) },
  replicate: {
    url: "https://api.replicate.com/v1/models/meta/meta-llama-3-70b-instruct",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    redirect: "manual",
    parseResponse: (data) => data?.owner === "meta" && data?.name === "meta-llama-3-70b-instruct"
      ? [{ id: "meta/meta-llama-3-70b-instruct", name: "Llama 3 70B Instruct" }] : [],
  },
  openference: {
    customResolver: async (connection, proxyOptions) => {
      if (!connection.accessToken) return { error: "No valid token found", status: 401 };
      const fetchModels = (token) => proxyAwareFetch("https://api.openference.com/v1/models", {
        headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(8000)
      }, proxyOptions);
      try {
        let response = await fetchModels(connection.accessToken);
        if (response.status === 401 && connection.refreshToken) {
          const refreshed = await refreshOpenferenceToken(connection, null, proxyOptions);
          if (refreshed?.accessToken) {
            await updateProviderCredentials(connection.id, refreshed);
            response = await fetchModels(refreshed.accessToken);
          }
        }
        if (!response.ok) return { error: `Openference models request failed: ${response.status}`, status: response.status };
        const data = await response.json();
        if (!Array.isArray(data?.data)) return { error: "Invalid Openference models response", status: 502 };
        return { models: data.data };
      } catch {
        return { error: "Openference models request failed", status: 502 };
      }
    }
  },
  llmtr: { ...createOpenAIModelsConfig("https://llmtr.com/v1/models"), parseResponse: parseLlmtrModels },
  "devin-cli-agentic": {
    customResolver: () => ({ models: getModelsByProviderId("devin-cli-agentic"), source: "local_catalog" }),
  },
  // Meta Model API: `GET /v1/models` lists the models the account's own key
  // can use, so discovery is account-scoped. The request is a documented
  // Model API call and carries no Muse Code client fingerprint.
  "muse-code": createOpenAIModelsConfig(META_MODEL_API_MODELS_URL),
  // Port of OmniRoute #15307: discover the live OpenAI-compatible catalogs.
  "xiaomi-mimo": createOpenAIModelsConfig("https://api.xiaomimimo.com/v1/models"),
  "xiaomi-mimo-token-plan": createOpenAIModelsConfig("https://token-plan-sgp.xiaomimimo.com/v1/models"),
  "xiaomi-tokenplan": createOpenAIModelsConfig("https://token-plan-sgp.xiaomimimo.com/v1/models"),
  commandcode: {
    customResolver: async (connection, proxyOptions) => {
      if (!connection.apiKey) return { error: "No valid token found", status: 401 };
      const result = await resolveCommandCodeModels((url, options) => proxyAwareFetch(url, options, proxyOptions));
      if (result) return result;
      return {
        models: getStaticProviderModels("commandcode"),
        warning: "CommandCode returned no live models. Showing the static catalog.",
      };
    },
  },
  claude: {
    url: "https://api.anthropic.com/v1/models?limit=1000",
    method: "GET",
    buildHeaders: buildClaudeModelsHeaders,
    parseResponse: (data) => data.data || []
  },
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    method: "GET",
    headers: { "Content-Type": "application/json" },
    authQuery: "key",
    // models.list defaults to 50 per page (max 1000) and pages by nextPageToken.
    pageSize: 1000,
    nextPageToken: (data) => (isString(data?.nextPageToken) && data.nextPageToken) || null,
    parseResponse: (data) => data.models || []
  },
  "gemini-interactions": {
    url: GEMINI_MODELS_URL,
    apiKeyOnly: true,
    redirect: "error",
    authHeader: "x-goog-api-key",
    pageSize: 1000,
    nextPageToken: (data) => (isString(data?.nextPageToken) && data.nextPageToken) || null,
    // Google models.list does not report Interactions support. Intersect it
    // with the text-only models verified in the Interactions overview.
    parseResponse: (data) => geminiInteractions.models.filter(({ id }) =>
      data.models?.some(({ name }) => name === `models/${id}`)),
  },
  qwen: {
    url: "https://portal.qwen.ai/v1/models",
    method: "GET",
    headers: { "Content-Type": "application/json" },
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    parseResponse: (data) => data.data || []
  },
  // Kimi web discovery uses the same access token as the chat executor.
  // GET returns an empty list, so POST {} is required; headers mirror the
  // www.kimi.com web app (Bearer, connect-protocol-version).
  "kimi-web": {
    url: `https://www.kimi.com${KIMI_WEB_MODELS_PATH}`,
    method: "POST",
    headers: { accept: "*/*", "Content-Type": "application/json" },
    body: {},
    // The route's generic token prefers the accessToken column, which may hold a
    // rotation of an older paste; resolveKimiTokens picks the current one.
    buildHeaders: (_token, connection) => {
      const { accessToken: jwt, origin } = resolveKimiTokens(connection);
      return {
        ...KIMI_WEB_DISCOVERY_HEADERS,
        Origin: origin,
        Referer: `${origin}/`,
        ...(jwt ? { Authorization: `Bearer ${jwt}` } : null)

      };
    },
    parseResponse: (data) => {
      // Chat-routable keys only; `k3-agent-ultra` (Swarm) needs the agent protocol.
      const allowed = new Set(["k3", "k2d6", "k2d6-thinking"]);
      const list = data?.availableModels || [];
      return list.
      filter((m) => m.key && allowed.has(m.key)).
      map((m) => ({
        id: m.key,
        name: m.displayName || m.key,
        supportsReasoning: m.thinking === true || (m.reasoningEffortOptions || []).some((o) => o?.effort !== "REASONING_EFFORT_NONE")
      }));
    }
  },
  codex: {
    url: `https://chatgpt.com/backend-api/codex/models?client_version=${CODEX_CLI_VERSION}`,
    redirect: "error",
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      // The catalog request carries the same CLI identity the Codex backend
      // sees on chat requests.
      // Upstream provenance: router-for-me/CLIProxyAPI
      // `cmd/fetch_codex_models/main.go` at
      // 6faa8d20b2673404cff70a2f2d9537ae0d0e684d (`fetchModels`).
      originator: "codex_cli_rs",
      "User-Agent": CODEX_CLI_USER_AGENT
    },
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    parseResponse: parseCodexModels
  },
  antigravity: {
    // The per-account Hub catalog replaces the stale sandbox models endpoint.
    url: ANTIGRAVITY_CATALOG_URL,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": ANTIGRAVITY_IDE_USER_AGENT,
      "X-Client-Name": "antigravity",
      "X-Client-Version": ANTIGRAVITY_IDE_VERSION
    },
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    // The catalog is account scoped: the request carries the signed-in
    // account's validated project instead of an empty body. A connection
    // without a usable project omits the field rather than sending a
    // placeholder.
    buildBody: (_token, connection) => buildAntigravityCatalogBody(connection),
    // Tell an auth rejection apart from a transient upstream failure, so a
    // dead credential is not read as a temporarily empty catalog.
    classifyStatus: classifyAntigravityCatalogStatus,
    // Returns null for a payload that is not a catalog, which keeps a known
    // catalog in place instead of replacing it with an empty list.
    parseResponse: parseAntigravityCatalogModels
  },
  // Enterprise discovery must use the connection's scoped token and tenant host.
  "ghe-copilot": {
    customResolver: async (connection, proxyOptions = null) => {
      const data = connection.providerSpecificData || {};
      const base = resolveGheCopilotApiBase(data);
      if (!base || !data.copilotToken) return { error: "Enterprise Copilot token or host missing; reconnect or refresh the connection", status: 401 };
      const response = await proxyAwareFetch(`${base}/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${data.copilotToken}`,
          "Copilot-Integration-Id": "vscode-chat",
          "editor-version": `vscode/${GITHUB_COPILOT.VSCODE_VERSION}`,
          "editor-plugin-version": `copilot-chat/${GITHUB_COPILOT.COPILOT_CHAT_VERSION}`,
          "user-agent": GITHUB_COPILOT.USER_AGENT,
          "x-github-api-version": GITHUB_COPILOT.API_VERSION
        },
        cache: "no-store"
      }, proxyOptions);
      if (!response.ok) return { error: `Enterprise Copilot models request failed: ${response.status}`, status: response.status };
      const rows = parseOpenAIStyleModels(await response.json());
      const models = rows.map((row) => withCopilotEndpointContract(row));
      await persistCopilotEndpointContract(connection, models);
      return { models };
    }
  },
  github: {
    customResolver: async (connection, proxyOptions = null) => {
      const result = await resolveCopilotModels({
        accessToken: connection.accessToken,
        refreshToken: connection.refreshToken,
        providerSpecificData: connection.providerSpecificData || {}
      }, {
        forceRefresh: true,
        includeMetadata: true,
        log: console,
        proxyOptions,
        onCredentialsRefreshed: async (refreshed) => {
          await updateProviderCredentials(connection.id, {
            copilotToken: refreshed.copilotToken,
            copilotTokenExpiresAt: refreshed.copilotTokenExpiresAt,
            existingProviderSpecificData: connection.providerSpecificData || {}
          });
        }
      });
      if (result?.models?.length) {
        await persistCopilotEndpointContract(connection, result.models);
        return { models: result.models };
      }
      return {
        models: [],
        warning: "GitHub Copilot returned no live models."
      };
    }
  },
  openai: createOpenAIModelsConfig("https://api.openai.com/v1/models"),
  // The public catalog lists every paid model too; the picker offers only
  // variants free for input and output (see isOpenRouterFreeModel).
  openrouter: {
    ...createOpenAIModelsConfig("https://openrouter.ai/api/v1/models"),
    parseResponse: (data) => {
      const models = parseOpenAIStyleModels(data);
      return Array.isArray(models) ? models.filter(isOpenRouterFreeModel) : [];
    }
  },
  // limit=1000 matches the claude entry above: Anthropic's default page size
  // truncates large catalogs (port of OmniRoute#14237).
  anthropic: {
    url: "https://api.anthropic.com/v1/models?limit=1000",
    method: "GET",
    headers: {
      "Anthropic-Version": "2023-06-01",
      "Content-Type": "application/json"
    },
    authHeader: "x-api-key",
    parseResponse: (data) => data.data || []
  },
  alicode: {
    url: "https://coding.dashscope.aliyuncs.com/v1/models",
    method: "GET",
    headers: { "Content-Type": "application/json" },
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    parseResponse: (data) => data.data || []
  },
  "alicode-intl": {
    url: "https://coding-intl.dashscope.aliyuncs.com/v1/models",
    method: "GET",
    headers: { "Content-Type": "application/json" },
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    parseResponse: (data) => data.data || []
  },
  "volcengine-ark": createOpenAIModelsConfig("https://ark.cn-beijing.volces.com/api/coding/v3/models"),
  byteplus: createOpenAIModelsConfig("https://ark.ap-southeast.bytepluses.com/api/v3/models"),
  deepseek: createOpenAIModelsConfig("https://api.deepseek.com/models"),
  groq: createOpenAIModelsConfig("https://api.groq.com/openai/v1/models"),
  xai: createOpenAIModelsConfig("https://api.x.ai/v1/models"),
  mistral: { ...createOpenAIModelsConfig("https://api.mistral.ai/v1/models"), parseResponse: parseMistralModels },
  perplexity: createOpenAIModelsConfig("https://api.perplexity.ai/v1/models"),
  together: createOpenAIModelsConfig("https://api.together.xyz/v1/models"),
  fireworks: createOpenAIModelsConfig("https://api.fireworks.ai/inference/v1/models"),
  cerebras: createOpenAIModelsConfig("https://api.cerebras.ai/v1/models"),
  cohere: createOpenAIModelsConfig("https://api.cohere.ai/v1/models"),
  nebius: createOpenAIModelsConfig("https://api.studio.nebius.ai/v1/models"),
  novita: createOpenAIModelsConfig("https://api.novita.ai/openai/v1/models"),
  siliconflow: createOpenAIModelsConfig("https://api.siliconflow.com/v1/models"),
  nan: createOpenAIModelsConfig("https://api.nan.builders/v1/models"),
  hyperbolic: createOpenAIModelsConfig("https://api.hyperbolic.xyz/v1/models"),
  paraloncloud: { ...createOpenAIModelsConfig("https://paraloncloud.com/v1/models"), apiKeyOnly: true },
  bai: createOpenAIModelsConfig("https://api.b.ai/v1/models"),
  ollama: createOpenAIModelsConfig("https://ollama.com/api/tags"),
  nanobanana: createOpenAIModelsConfig("https://api.nanobananaapi.ai/v1/models"),
  chutes: { ...createOpenAIModelsConfig("https://llm.chutes.ai/v1/models"), parseResponse: (data) => FILTERS["chutes-all"](parseOpenAIStyleModels(data)) },
  nvidia: createOpenAIModelsConfig("https://integrate.api.nvidia.com/v1/models"),
  assemblyai: createOpenAIModelsConfig("https://api.assemblyai.com/v1/models"),
  "vercel-ai-gateway": createOpenAIModelsConfig("https://ai-gateway.vercel.sh/v1/models"),
  hcnsec: createOpenAIModelsConfig("https://api.hcnsec.cn/v1/models"),
  // DotHoosh publishes no static catalog: the model list is the provider's own
  // listing, read per key. Both listings are merged so a model that only the
  // Anthropic path serves is listed too.
  dothoosh: {
    customResolver: async (connection, proxyOptions = null) => {
      const apiKey = connection.apiKey;
      if (!apiKey) return { error: "No valid token found", status: 401 };
      const [openai, anthropic] = await Promise.all([
        fetchDotHooshListing(DOTHOOSH_OPENAI_MODELS_URL, "openai", apiKey, proxyOptions),
        fetchDotHooshListing(DOTHOOSH_ANTHROPIC_MODELS_URL, "anthropic", apiKey, proxyOptions)
      ]);
      const models = mergeDotHooshListings({ openai: openai.rows, anthropic: anthropic.rows });
      if (!models.length) {
        // One listing may be empty while the other answers; only a total
        // failure is an error, and a rejected key is reported as such.
        const failure = openai.error ? openai : anthropic;
        const status = failure.status;
        if (status === 401 || status === 403) {
          return { error: "Invalid API key", status: 401 };
        }
        return { error: "DotHoosh returned no models", status: 502 };
      }
      return { models };
    }
  },
  kimchi: {
    customResolver: async (connection, proxyOptions = null) => {
      const result = await resolveKimchiModels({
        accessToken: connection.accessToken,
        apiKey: connection.apiKey,
        providerSpecificData: connection.providerSpecificData || {}
      }, { forceRefresh: true, log: console, proxyOptions });
      if (result?.models?.length) {
        return { models: result.models };
      }
      return {
        models: getStaticProviderModels("kimchi"),
        warning: "Kimchi returned no live models; falling back to static catalog."
      };
    }
  },
  // Cursor API key connection: discovery exchanges the key for a session token, so a
  // connection that has not opted in to dispatch never reaches the exchange.
  "cursor-api": {
    customResolver: async (connection, proxyOptions = null) => {
      if (!isCursorApiDispatchEnabled(connection)) {
        return { error: "Cursor API dispatch is disabled for this connection", status: 403 };
      }
      if (!connection.apiKey) return { error: "No valid token found", status: 401 };
      try {
        // Lazy: a static import of the executor map forms a cycle through the provider config.
        const { getExecutor } = await import("open-sse/executors/index.js");
        return await discoverCursorApiModels(connection, {
          proxyOptions,
          executor: getExecutor("cursor-api"),
          staticModels: getStaticProviderModels("cursor-api")
        });
      } catch (error) {
        return { error: sanitizeErrorMessage(error?.message || "Cursor API model discovery failed"), status: Number.isInteger(error?.status) ? error.status : 502 };
      }
    }
  },
  // Devin Desktop lists models over a Connect protobuf call. Live ids win membership;
  // the registry catalog answers when discovery fails or returns nothing.
  "devin-desktop": {
    customResolver: async (connection, proxyOptions = null) => {
      if (!isDevinDesktopDispatchEnabled(connection)) {
        return { error: "Devin Desktop dispatch is disabled for this connection", status: 403 };
      }
      const token = connection.accessToken || connection.apiKey;
      if (!token) return { error: "No valid token found", status: 401 };
      const fallback = (warning) => ({ models: getStaticProviderModels("devin-desktop"), warning, source: "local_catalog" });
      try {
        const live = await discoverDevinDesktopModels(token, {
          fetchImpl: (url, init) => guardedProbeFetch(url, init, getProviderValidationGuard(), (target, options) => proxyAwareFetch(target, options, proxyOptions))
        });
        if (live.length) return { models: live };
        return fallback("Devin returned no live models; falling back to the static catalog.");
      } catch {
        return fallback("Devin model discovery failed; falling back to the static catalog.");
      }
    }
  },
  // WorkBuddy reads the authenticated /v3/config catalog.
  workbuddy: workbuddyModelsConfig,
  cursor: {
    customResolver: async (connection, proxyOptions = null) => {
      const result = await resolveCursorModels({
        accessToken: connection.accessToken,
        providerSpecificData: connection.providerSpecificData || {}
      }, { forceRefresh: true, log: console, proxyOptions });
      if (result?.models?.length) {
        return { models: result.models.map((m) => ({ id: m.id, name: m.name })) };
      }
      return {
        models: getStaticProviderModels("cursor"),
        warning: "Cursor returned no live models; falling back to static catalog."
      };
    }
  },
  kiro: {
    customResolver: async (connection, proxyOptions = null) => {
      const credentials = {
        accessToken: connection.accessToken,
        refreshToken: connection.refreshToken,
        providerSpecificData: connection.providerSpecificData || {}
      };
      let warning;
      try {
        const result = await resolveKiroModels(credentials, {
          log: console,
          proxyOptions,
          onCredentialsRefreshed: async (refreshed) => {
            if (refreshed?.accessToken) {
              await updateProviderCredentials(connection.id, {
                accessToken: refreshed.accessToken,
                refreshToken: refreshed.refreshToken || connection.refreshToken,
                expiresIn: refreshed.expiresIn
              });
              connection.accessToken = refreshed.accessToken;
              if (refreshed.refreshToken) connection.refreshToken = refreshed.refreshToken;
            }
          }
        });
        if (result?.models?.length) {
          return {
            models: result.models.map((m) => ({
              id: m.id,
              name: m.name,
              upstreamModelId: m.upstreamModelId,
              contextLength: m.contextLength,
              rateMultiplier: m.rateMultiplier,
              capabilities: m.capabilities,
              description: m.description
            }))
          };
        }
        warning = "Kiro returned no models; falling back to static catalog.";
      } catch (error) {
        const safeError = sanitizeErrorMessage(error?.message);
        warning = `Failed to fetch Kiro models: ${safeError}`;
        console.log("Failed to fetch Kiro models dynamically, falling back to static:", safeError);
      }
      return { models: [], warning };
    }
  },
  qoder: buildQoderModelsResolver("qoder"),
  "qoder-cn": buildQoderModelsResolver("qoder-cn"),
  "gemini-cli": {
    customResolver: buildOAuthResolver({
      refreshFn: (conn, proxyOptions) => refreshGoogleToken(
        conn.refreshToken,
        process.env.GEMINI_CLIENT_ID,
        process.env.GEMINI_CLIENT_SECRET,
        proxyOptions
      ),
      fetchFn: (token, conn, proxyOptions) => {
        const projectId = conn.projectId || conn.providerSpecificData?.projectId;
        const body = projectId ? { project: projectId } : {};
        return proxyAwareFetch(GEMINI_CLI_MODELS_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
            "User-Agent": "google-api-nodejs-client/9.15.1",
            "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1"
          },
          body: JSON.stringify(body)
        }, proxyOptions);
      },
      parseFn: parseGeminiCliModels,
      errorLabel: "Failed to fetch Gemini CLI models"
    })
  },
  agy: {
    customResolver: buildOAuthResolver({
      refreshFn: (conn, proxyOptions) => refreshGoogleToken(
        conn.refreshToken,
        ANTIGRAVITY_OAUTH_CLIENT.clientId,
        ANTIGRAVITY_OAUTH_CLIENT.clientSecret,
        proxyOptions
      ),
      fetchFn: (token, conn, proxyOptions) => {
        const projectId = conn.projectId || conn.providerSpecificData?.projectId;
        const body = projectId ? { project: projectId } : {};
        return proxyAwareFetch(GEMINI_CLI_MODELS_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
            // Same Hub identity as the Antigravity quota call to this endpoint
            // (open-sse/services/usage/google.js).
            "User-Agent": ANTIGRAVITY_IDE_USER_AGENT,
            "X-Client-Name": "antigravity",
            "X-Client-Version": ANTIGRAVITY_IDE_VERSION
          },
          body: JSON.stringify(body)
        }, proxyOptions);
      },
      parseFn: parseGeminiCliModels,
      errorLabel: "Failed to fetch Antigravity CLI models",
      refreshBlockedError: (conn) => antigravityClientBindingBlocks(conn.provider || "agy", conn.providerSpecificData, ANTIGRAVITY_OAUTH_CLIENT.clientId)
        ? antigravityClientBindingError()
        : null
    })
  },
  mlx: {
    customResolver: async (connection, proxyOptions = null) => {
      const base = (connection.providerSpecificData?.baseUrl || mlx.transport.baseUrl).replace(/\/+$/, "");
      try {
        const headers = connection.apiKey ? { Authorization: `Bearer ${connection.apiKey}` } : {};
        const response = await guardedProbeFetch(`${base}/models`, {
          method: "GET", headers, cache: "no-store", signal: AbortSignal.timeout(8000)
        }, getProviderValidationGuard(), (url, options) => proxyAwareFetch(url, options, proxyOptions));
        if (!response.ok) return { error: `Failed to fetch models: ${response.status}`, status: response.status };
        return { models: parseOpenAIStyleModels(await response.json()) };
      } catch (error) {
        console.log("Error fetching models from mlx:", sanitizeErrorMessage(error?.message));
        return { error: "Failed to fetch models", status: 500 };
      }
    }
  },
  "ollama-local": {
    customResolver: async (connection, proxyOptions = null) => {
      const host = resolveOllamaLocalHost(connection);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      try {
        return await discoverOllamaCatalog({
          host,
          accountId: connection.id || "",
          fetchImpl: (path, init) => guardedProbeFetch(`${host}${path}`, { ...init, cache: "no-store", signal: controller.signal }, getProviderValidationGuard(), (url, options) => proxyAwareFetch(url, options, proxyOptions))
        });
      } finally {
        clearTimeout(timeoutId);
      }
    }
  },
  typesafe: {
    customResolver: async (connection, proxyOptions = null) => {
      const token = connection.accessToken || connection.apiKey;
      if (!token) return { error: "No valid token found", status: 401 };
      const response = await proxyAwareFetch("https://api.typesafe.ai/v1/models", {
        method: "GET", headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(8000)
      }, proxyOptions);
      if (!response.ok) return { error: `Failed to fetch models: ${response.status}`, status: response.status };
      const data = await response.json();
      const models = Array.isArray(data?.models) ? data.models.flatMap((model) => {
        const id = isString(model?.name) ? model.name : "";
        return id ? [{ ...model, id, kind: "systemone" }] : [];
      }) : [];
      return { models };
    }
  },
  venice: {
    customResolver: async (connection, proxyOptions = null) => {
      const token = connection.accessToken || connection.apiKey;
      if (!token) return { error: "No valid token found", status: 401 };
      const response = await proxyAwareFetch("https://api.venice.ai/api/v1/models", {
        method: "GET", headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(8000)
      }, proxyOptions);
      if (!response.ok) return { error: `Failed to fetch models: ${response.status}`, status: response.status };
      const data = await response.json();
      return { models: parseOpenAIStyleModels(data).map(normalizeVeniceModel).filter(Boolean) };
    }
  },
  // OrcaRouter's catalog is capability-scoped (`?capability=`), so it needs the
  // resolver form rather than a registry-level modelsFetcher. The key stays here.
  [ORCAROUTER_ID]: {
    customResolver: resolveOrcaRouterModels
  },
  // Gisoo's catalog is public (`GET /api/v1/models` needs no key and answers
  // 200 even for an invalid one), so discovery runs without an Authorization
  // header: the stored key never leaves the server for a request that does not
  // need it, and the request target is the registry constant rather than the
  // connection's client-writable baseUrl.
  gisoo: {
    customResolver: async (connection, proxyOptions = null) => {
      const result = await discoverGisooModels({
        fetchImpl: (url, init) => proxyAwareFetch(url, init, proxyOptions),
      });
      if (result.error) return { error: result.error, status: result.status };
      return { models: result.models };
    }
  }
};

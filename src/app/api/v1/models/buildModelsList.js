import { KIMI_CODING_MODELS_URL } from "../../../../../open-sse/providers/shared.js";
import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import {
  AI_PROVIDERS,
  getProviderAlias,
  isAnthropicCompatibleProvider,
  isOpenAICompatibleProvider,
  isLocalOllamaProvider } from
"@/shared/constants/providers";
import { getProviderConnections, getCombos, getCustomModels, getModelAliases } from "@/lib/localDb";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { isFreeNoAuthProviderDisabled } from "@/sse/services/freeProviderGate.js";
import { getSettings } from "@/lib/db/repos/settingsRepo";
import { updateProviderCredentials } from "@/sse/services/tokenRefresh";
import { resolveOllamaLocalHost } from "open-sse/config/providers.js";
import { resolveKiroModels } from "open-sse/services/kiroModels.js";
import { resolveQoderModels } from "open-sse/services/qoderModels.js";
import { resolveCopilotModels } from "open-sse/services/copilotModels.js";
import { resolveClinepassModels } from "open-sse/services/clinepassModels.js";
import { resolveClineModels } from "open-sse/services/clineModels.js";
import {
  resolveLiveAnthropicModels,
  resolveLiveCloudflareModels,
  resolveLiveModelIds,
  resolveLiveOpenAIModels } from
"open-sse/services/liveModelLimits.js";
import { getCodexModels } from "open-sse/services/usage/codex.js";
import { aggregateComboCapabilities, capabilitiesFromServiceKind, getCapabilitiesForModel, resolveModelLimits } from "open-sse/providers/capabilities.js";
import { isPaidModel } from "open-sse/providers/pricing.js";
import { guardedProbeFetch, getProviderValidationGuard } from "open-sse/utils/outboundUrlGuard.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
import { projectModelPresentation } from "open-sse/providers/models/presentation.js";

// In-flight request coalescing for `buildModelsList` (OmniRoute #6440):
// concurrent `/v1/models` calls that hit before the first one resolves would
// otherwise each re-run the full provider/combo/catalog aggregation. Map key
// is the serialized kindFilter so `["llm"]` (root) and `["image"]` do not
// collide, but two simultaneous `["llm"]` requests share ONE promise. Only the
// in-flight promise is shared — settled results are NEVER cached (the key is
// deleted in `finally`), so DB/credential changes are observed on the next
// request and a rejection cannot poison future calls.
import { isObject, isString } from "../../../../shared/utils/typeChecks.js";
const modelsInFlight = new Map();

function kindFilterKey(kindFilter) {
  return Array.isArray(kindFilter) ? kindFilter.slice().sort().join("\0") : "";
}

function isRecord(value) {
  return value !== null && isObject(value) && !Array.isArray(value);
}

// Per-provider live model resolvers. Each receives a connection record and
// returns { models: [{ id, name? }, ...] } | null on failure.
// Adding a provider here makes /v1/models prefer the live catalog for it.
// Known Ollama embedding families plus the `embed` substring heuristic.
// Rationale: Ollama `/api/tags` exposes only `name`/`model` and optional
// `details.family/families`; not every embedding model has "embed" in its
// tag (e.g. `bge-m3`, `all-minilm`). We match these known families against the
// normalized model ID and any available family metadata, falling back to the
// substring heuristic. A capability probe (`/api/show`) would be one extra
// round-trip per model, so we avoid it here in favor of this cheap, tested
// classification. Expand this list as new Ollama embedding families appear.
//
// Match is exact on the normalized token sequence (e.g. `snowflake-arctic-embed`
// matches only `snowflake arctic embed`, not `snowflake-arctic-instruct`).
const OLLAMA_EMBEDDING_FAMILIES = [
"bge",
"minilm",
"nomic-embed",
"mxbai-embed",
"snowflake-arctic-embed",
"all-minilm",
"e5",
"gte"];


function normalizeEmbeddingHaystack(...parts) {
  return parts.
  filter((p) => isString(p)).
  join(" ").
  toLowerCase().
  replace(/[^a-z0-9]+/g, " ").
  trim();
}

function tokenSequenceMatches(tokens, sequence) {
  if (sequence.length === 0) return false;
  if (sequence.length === 1) return tokens.includes(sequence[0]);
  for (let i = 0; i <= tokens.length - sequence.length; i++) {
    let match = true;
    for (let j = 0; j < sequence.length; j++) {
      if (tokens[i + j] !== sequence[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

function isOllamaEmbeddingModel(model) {
  if (!isRecord(model)) return false;
  const id = isString(model.id) ? model.id : "";
  const name = isString(model.name) ? model.name : "";
  if (!id && !name) return false;

  if (/embed/.test(id.toLowerCase()) || /embed/.test(name.toLowerCase())) return true;

  const details = isRecord(model.details) ? model.details : {};
  const families = Array.isArray(details.families) ? details.families : [];
  const haystack = normalizeEmbeddingHaystack(id, name, details.family, ...families);
  const tokens = haystack.split(/\s+/).filter(Boolean);

  for (const family of OLLAMA_EMBEDDING_FAMILIES) {
    const sequence = normalizeEmbeddingHaystack(family).split(/\s+/).filter(Boolean);
    if (tokenSequenceMatches(tokens, sequence)) return true;
  }
  return false;
}
// Kimi Code live IDs are canonical; no static remapping is required.
const KIMI_LIVE_MODEL_PROVIDERS = new Set(["kimi", "kimi-coding", "kimi-coding-apikey"]);
/** Providers whose discovered models extend, rather than only enrich, their static catalog. */
const LIVE_MODEL_UNION_PROVIDERS = new Set([
"anthropic",
"claude",
"cline",
"codex",
"groq",
"minimax",
"minimax-cn",
"glm",
"glm-cn"]
);

async function liveResolverOptions(conn) {
  const psd = isRecord(conn.providerSpecificData) ? conn.providerSpecificData : {};
  return {
    provider: conn.provider,
    proxyOptions: await resolveConnectionProxyConfig(psd)
  };
}


const LIVE_MODEL_RESOLVERS = {
  anthropic: async (conn, guard) => resolveLiveAnthropicModels(conn, {
    ...(await liveResolverOptions(conn)),
    guard
  }),
  claude: async (conn, guard) => resolveLiveAnthropicModels(conn, {
    ...(await liveResolverOptions(conn)),
    guard
  }),
  "cloudflare-ai": async (conn, guard) => resolveLiveCloudflareModels(conn, {
    ...(await liveResolverOptions(conn)),
    guard
  }),
  minimax: async (conn, guard) => resolveLiveModelIds(conn, "https://api.minimax.io/v1/models", {
    ...(await liveResolverOptions(conn)),
    guard
  }),
  "minimax-cn": async (conn, guard) => resolveLiveModelIds(conn, "https://api.minimaxi.com/v1/models", {
    ...(await liveResolverOptions(conn)),
    guard
  }),
  glm: async (conn, guard) => resolveLiveModelIds(conn, "https://api.z.ai/api/coding/paas/v4/models", {
    ...(await liveResolverOptions(conn)),
    guard
  }),
  "glm-cn": async (conn, guard) => resolveLiveModelIds(conn, "https://open.bigmodel.cn/api/coding/paas/v4/models", {
    ...(await liveResolverOptions(conn)),
    guard
  }),
  codex: async (conn) => {
    const proxyOptions = (await liveResolverOptions(conn)).proxyOptions;
    const entries = await getCodexModels(
      conn.accessToken,
      proxyOptions,
      isRecord(conn.providerSpecificData) ? conn.providerSpecificData : {},
      conn.idToken
    );
    const models = entries.flatMap((entry) => {
      const id = isString(entry?.slug) ? entry.slug.trim() : "";
      if (!id) return [];
      const contextWindow = Number(entry.context_window);
      return [{
        id,
        ...(Number.isSafeInteger(contextWindow) && contextWindow > 0 ?
        { capabilities: { contextWindow } } : null)

      }];
    });
    return models.length ? { models } : null;
  },
  kiro: async (conn) => {
    const psd = isRecord(conn.providerSpecificData) ? conn.providerSpecificData : {};
    const proxyOptions = await resolveConnectionProxyConfig(psd);
    const result = await resolveKiroModels({
      accessToken: isString(conn.accessToken) ? conn.accessToken : undefined,
      refreshToken: isString(conn.refreshToken) ? conn.refreshToken : undefined,
      providerSpecificData: psd
    }, {
      log: console,
      proxyOptions,
      onCredentialsRefreshed: async (refreshed) => {
        if (!refreshed?.accessToken || !conn.id) return;
        await updateProviderCredentials(conn.id, {
          ...refreshed,
          existingProviderSpecificData: psd,
          testStatus: "active"
        });
        conn.accessToken = refreshed.accessToken;
        if (refreshed.refreshToken) conn.refreshToken = refreshed.refreshToken;
        if (isRecord(refreshed.providerSpecificData)) {
          conn.providerSpecificData = {
            ...psd,
            ...refreshed.providerSpecificData
          };
        }
      }
    });
    if (!result?.models?.length) return null;
    const models = result.models.
    filter((m) => isRecord(m) && isString(m.id)).
    map((m) => {
      const model = { id: m.id };
      if (isString(m.name)) model.name = m.name;
      return model;
    });
    return models.length ? { models } : null;
  },
  qoder: async (conn) => {
    const result = await resolveQoderModels({
      accessToken: isString(conn.accessToken) ? conn.accessToken : undefined,
      refreshToken: isString(conn.refreshToken) ? conn.refreshToken : undefined,
      email: isString(conn.email) ? conn.email : undefined,
      displayName: isString(conn.displayName) ? conn.displayName : undefined,
      providerSpecificData: isRecord(conn.providerSpecificData) ? conn.providerSpecificData : {}
    });
    if (!result?.models?.length) return null;
    return {
      models: result.models.map((m) => ({ id: m.id, name: m.name }))
    };
  },
  github: async (conn) => {
    const psd = isRecord(conn.providerSpecificData) ? conn.providerSpecificData : {};
    const proxyOptions = await resolveConnectionProxyConfig(psd);
    const result = await resolveCopilotModels({
      accessToken: isString(conn.accessToken) ? conn.accessToken : undefined,
      refreshToken: isString(conn.refreshToken) ? conn.refreshToken : undefined,
      providerSpecificData: psd
    }, {
      log: console,
      proxyOptions,
      onCredentialsRefreshed: async (refreshed) => {
        if (!conn.id) return;
        await updateProviderCredentials(conn.id, {
          copilotToken: refreshed.copilotToken,
          copilotTokenExpiresAt: refreshed.copilotTokenExpiresAt,
          existingProviderSpecificData: psd
        });
      }
    });
    if (!result?.models?.length) return null;
    const models = result.models.
    filter((m) => isString(m.id)).
    map((m) => ({ id: m.id, ...(isString(m.name) ? { name: m.name } : null) }));
    return models.length ? { models } : null;
  },
  cline: async (conn) => {
    const models = await resolveClineModels(conn, await liveResolverOptions(conn));
    return models.length ? { models } : null;
  },
  clinepass: async (conn) => {
    const result = await resolveClinepassModels({
      accessToken: isString(conn.accessToken) ? conn.accessToken : undefined,
      apiKey: isString(conn.apiKey) ? conn.apiKey : undefined
    });
    if (!result?.models?.length) return null;
    const models = result.models.
    filter((m) => isString(m.id)).
    map((m) => ({ id: m.id, ...(isString(m.name) ? { name: m.name } : null) }));
    return models.length ? { models } : null;
  },
  "ollama-local": async (conn, guard) => {
    const host = resolveOllamaLocalHost(conn);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
      // /api/tags lists installed models but no served num_ctx. /api/ps is the
      // authoritative live source for context_length; merge it when available.
      const psd = isRecord(conn.providerSpecificData) ? conn.providerSpecificData : {};
      const proxyOptions = await resolveConnectionProxyConfig(psd);
      const proxiedFetch = (fetchUrl, init) => proxyAwareFetch(fetchUrl, init, proxyOptions || null);
      const fetchJson = async (path, required = false) => {
        try {
          const response = await guardedProbeFetch(`${host}${path}`, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
            signal: controller.signal
          }, guard, proxiedFetch);
          return response.ok ? response.json() : null;
        } catch (error) {
          if (required) throw error;
          return null;
        }
      };
      const tags = await fetchJson("/api/tags", true);
      const list = parseOpenAIStyleModels(tags);
      if (!Array.isArray(list)) return null;
      const running = parseOpenAIStyleModels(await fetchJson("/api/ps"));
      const liveContexts = new Map(
        running.
        map((m) => [m?.name || m?.model, Number(m?.context_length)]).
        filter(([id, contextWindow]) => isString(id) && Number.isFinite(contextWindow) && contextWindow > 0)
      );
      const models = list.
      map((m) => {
        if (!isRecord(m)) return null;
        const id = isString(m.id) ? m.id : isString(m.name) ? m.name : "";
        if (!id) return null;
        const isEmbedding = isOllamaEmbeddingModel(m);
        const contextWindow = liveContexts.get(id);
        return {
          id,
          name: id,
          ...(isEmbedding ? { kind: "embedding" } : null),
          ...(contextWindow ? { capabilities: { contextWindow } } : null)
        };
      }).
      filter(Boolean);
      return models.length ? { models } : null;
    } finally {
      clearTimeout(timeoutId);
    }
  }
};

const parseOpenAIStyleModels = (data) => {
  if (Array.isArray(data)) return data;
  if (!isRecord(data)) return [];
  const list = data.data ?? data.models ?? data.results;
  return Array.isArray(list) ? list : [];
};

const OPENAI_MODELS_FETCHER_TYPES = new Set(["openai", "openai-compatible"]);



// LLM kind sentinel — combos/models with no explicit kind default to LLM
export const LLM_KIND = "llm";

// Map per-model `type` field (in PROVIDER_MODELS) to service kind.
// Models without `type` are treated as LLM.
const MODEL_TYPE_TO_KIND = {
  image: "image",
  tts: "tts",
  embedding: "embedding",
  stt: "stt",
  imageToText: "imageToText",
  rerank: "rerank",
  video: "video"
};

function modelKind(model) {
  const k = model?.kind || model?.type;
  if (!k) return LLM_KIND;
  return MODEL_TYPE_TO_KIND[k] ?? LLM_KIND;
}

// For dynamic/unknown model IDs (compatible providers, alias map, custom models)
// fall back to provider-level kind matching when per-model type is unavailable.
function inferKindFromUnknownModelId(modelId) {
  const lower = String(modelId).toLowerCase();
  if (/embed/.test(lower)) return "embedding";
  if (/tts|speech|audio|voice/.test(lower)) return "tts";
  if (/image|imagen|dall-?e|flux|sdxl|sd-|stable-diffusion/.test(lower)) return "image";
  return LLM_KIND;
}

function customModelKind(m) {
  const raw = m.kind || m.type;
  if (!isString(raw)) return LLM_KIND;
  return MODEL_TYPE_TO_KIND[raw] ?? LLM_KIND;
}


/**
 * Fetch model IDs for passthrough local providers (lm-studio, vllm, lemonade)
 * by hitting the connection's baseUrl (or provider defaultBaseUrl) + /models.
 * Sends Authorization: Bearer apiKey when the connection has one so gated
 * deployments still respond.
 */
async function fetchLocalPassthroughModels(connection, guard) {
  const providerId = connection?.provider;
  const provider = providerId ? AI_PROVIDERS[providerId] : null;
  if (!provider?.passthroughModels) return [];
  const psd = isRecord(connection.providerSpecificData) ? connection.providerSpecificData : {};
  const psdBaseUrl = isString(psd.baseUrl) ? psd.baseUrl.trim().replace(/\/$/, "") : "";
  const defaultBaseUrl = isString(provider.defaultBaseUrl) ? provider.defaultBaseUrl.trim().replace(/\/$/, "") : "";
  const baseUrlRaw = psdBaseUrl || defaultBaseUrl;
  if (!baseUrlRaw) return [];

  const url = `${baseUrlRaw}/models`;
  const headers = { "Content-Type": "application/json" };
  if (isString(connection.apiKey) && connection.apiKey) {
    headers.Authorization = `Bearer ${connection.apiKey}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    // #6966: SSRF-guarded (local-first) — see buildModelsList JSDoc.
    const response = await guardedProbeFetch(url, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: controller.signal
    }, guard);
    if (!response.ok) return [];
    const data = await response.json();
    const list = Array.isArray(data) ? data : data?.data ?? data?.models ?? data?.results;
    if (!Array.isArray(list)) return [];
    return Array.from(new Set(
      list.
      map((m) => isRecord(m) ? m.id || m.name || m.model : "").
      filter((id) => isString(id) && id.trim() !== "")
    ));
  } catch {
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}


// Provider matches kindFilter when its serviceKinds intersect the requested kinds.
// LLM is the default kind for providers missing serviceKinds.
function providerMatchesKinds(providerId, kindFilter) {
  if (isLocalOllamaProvider(providerId) && kindFilter.includes("embedding")) return true;
  const provider = AI_PROVIDERS[providerId];
  const serviceKinds = provider?.serviceKinds;
  const kinds = Array.isArray(serviceKinds) && serviceKinds.length > 0 ?
  serviceKinds.filter((k) => isString(k)) :
  [LLM_KIND];
  return kindFilter.some((k) => kinds.includes(k));
}

// Combo matches kindFilter when its `kind` field is in the list.
// Combos with no kind are treated as LLM.
function comboMatchesKinds(combo, kindFilter) {
  const kind = combo?.kind ?? LLM_KIND;
  return kindFilter.includes(kind);
}

/**
 * Project a combo into the public OpenAI model shape. Web kind stays explicit
 * because search and fetch clients share the models endpoint.
 */
function comboToEntry(combo) {
  const entry = {
    id: combo.name,
    object: "model",
    owned_by: "combo"
  };
  if (combo.kind === "webSearch" || combo.kind === "webFetch") entry.kind = combo.kind;
  return entry;
}

/**
 * Resolve a combo's member pool through saved nested combos, applying the
 * existing provider/model paid classifier once at each concrete member.
 * Unknown legacy members stay visible; empty and cyclic resolved pools do not.
 */
function visibleComboMembers(combo, comboByName, hidePaidModels) {
  const members = Array.isArray(combo?.models) ? combo.models : [];
  if (!hidePaidModels) return members;

  const isVisible = (member, seen) => {
    if (!isString(member)) return true;
    if (member.includes("/")) return !isPaidModel(member);
    if (seen.has(member)) return false;
    const nested = comboByName[member];
    if (!Array.isArray(nested)) return true;
    seen.add(member);
    const visible = nested.some((nestedMember) => isVisible(nestedMember, seen));
    seen.delete(member);
    return visible;
  };

  return members.filter((member) => isVisible(member, new Set([combo.name])));
}

/**
 * Build OpenAI-format models filtered by service kind. Built-in catalogs are a
 * DB-read failure fallback; a healthy empty DB exposes only explicit custom,
 * combo, and keyless catalogs rather than pretending every provider is saved.
 * @param {string[]} kindFilter - List of service kinds to include (e.g. ["llm"], ["webSearch","webFetch"]).
 * @param {{ exposeComboOnly?: boolean }} [options] - Internal catalog exposure override.
 * @returns {Promise<object[]>} OpenAI-format model entries.
 */
async function buildModelsListImpl(kindFilter, guard, options = {}) {
  // Start the real aggregation FIRST so `getProviderConnections()` is called
  // synchronously — required by the #6440 coalescing identity test, which holds
  // the first in-flight promise open via mockReturnValueOnce and asserts it was
  // called exactly once in this tick. Read the #6495/F-4 opt-in concurrently
  // (fail-closed to off so a settings DB error never hides paid models).
  const connectionsPromise = getProviderConnections();
  let settings = null;
  let hidePaidModels = false;
  let exposeComboOnly = false;
  try {
    settings = await getSettings();
    hidePaidModels = settings?.hidePaidModels === true;
    exposeComboOnly = options.exposeComboOnly ?? (settings?.exposeComboOnly === true);
  } catch (e) {
    hidePaidModels = false;
    exposeComboOnly = false;
  }

  const isFreeNoAuthDisabled = (providerId) =>
  isFreeNoAuthProviderDisabled(providerId, settings);

  let dbAvailable = true;
  let connections = [];
  try {
    connections = await connectionsPromise;
    connections = connections.filter((c) => c.isActive !== false);
  } catch (e) {
    dbAvailable = false;
    console.log("Could not fetch providers, returning all models");
  }

  let combos = [];
  try {
    combos = (await getCombos()).filter((c) => c !== null);
  } catch (e) {
    console.log("Could not fetch combos");
  }

  const comboByName = Object.fromEntries(combos.map((combo) => [combo.name, combo.models || []]));

  // decolua/9router#3429: combo-only exposure must return before direct model
  // catalogs are read or probed. Preserve first occurrence order by combo ID.
  if (exposeComboOnly) {
    const seen = new Set();
    const models = [];
    for (const combo of combos) {
      if (!comboMatchesKinds(combo, kindFilter) || seen.has(combo.name)) continue;
      const visibleMembers = visibleComboMembers(combo, comboByName, hidePaidModels);
      if (hidePaidModels && visibleMembers.length === 0) continue;
      seen.add(combo.name);
      models.push(comboToEntry(combo));
    }
    return models;
  }

  let customModels = [];
  try {
    customModels = await getCustomModels();
  } catch (e) {
    console.log("Could not fetch custom models");
  }

  let modelAliases = {};
  try {
    modelAliases = await getModelAliases();
  } catch (e) {
    console.log("Could not fetch model aliases");
  }

  let disabledByAlias = {};
  try {
    disabledByAlias = await getDisabledModels();
  } catch (e) {
    console.log("Could not fetch disabled models");
  }
  const isDisabled = (alias, modelId) => Array.isArray(disabledByAlias[alias]) && (disabledByAlias[alias] ?? []).includes(modelId);

  const activeConnectionByProvider = new Map();
  for (const conn of connections) {
    if (!activeConnectionByProvider.has(conn.provider)) {
      activeConnectionByProvider.set(conn.provider, conn);
    }
  }

  const models = [];
  // Model ids below are prefixed with outputAlias (static alias or the active
  // connection's custom prefix), so map each exposed alias back to the
  // provider id — needed for combo capability aggregation on ids like
  // `mykr/<model>` whose prefix is not a registered provider alias.
  const aliasToProviderId = Object.fromEntries(
    Object.entries(PROVIDER_ID_TO_ALIAS).map(([id, alias]) => [alias, id])
  );
  // Overlay active connections so custom prefixes (providerSpecificData.prefix)
  // and the provider's static alias both map back to the provider id. Saved combos
  // may still reference the static alias even after a prefix is configured, and
  // the no-connection fallback catalog also needs the static alias map.
  for (const [providerId, conn] of activeConnectionByProvider) {
    const staticAlias = PROVIDER_ID_TO_ALIAS[providerId] ?? providerId;
    const prefix = isRecord(conn.providerSpecificData) ? conn.providerSpecificData.prefix : undefined;
    const outputAlias = (
    (isString(prefix) ? prefix : undefined) ||
    getProviderAlias(providerId) ||
    staticAlias).
    trim();
    aliasToProviderId[outputAlias] = providerId;
    aliasToProviderId[staticAlias] = providerId;
    aliasToProviderId[providerId] = providerId;
  }

  const attachModelLimits = (model, providerId, modelId, explicitCaps = {}, liveLimits = null) => {
    // #3218: expose proven limits in OpenAI's flat model schema. Generic
    // default capabilities are not evidence of a provider guarantee. Live
    // metadata is injected by this server-only builder so capabilities.js
    // remains safe for dashboard client bundles.
    const positive = (value) => Number.isFinite(value) && value > 0;
    let contextWindow = explicitCaps.contextWindow;
    let maxOutput = explicitCaps.maxOutput;
    const explicitKeys = explicitCaps.customKeys instanceof Set ? explicitCaps.customKeys : null;
    const fallback = resolveModelLimits(providerId, modelId, explicitCaps, null, liveLimits);
    if (!positive(contextWindow) && fallback.known && !explicitKeys?.has("contextWindow")) contextWindow = fallback.contextWindow;
    if (!positive(maxOutput) && fallback.known && !explicitKeys?.has("maxOutput")) maxOutput = fallback.maxOutput;
    if (positive(contextWindow)) model.context_length = contextWindow;
    if (positive(maxOutput)) model.max_completion_tokens = maxOutput;
    return model;
  };

  const addStaticProviderModels = (providerId, alias, { hasCredentials = false } = {}) => {
    if (!providerMatchesKinds(providerId, kindFilter)) return;
    for (const model of PROVIDER_MODELS[alias] ?? []) {
      if (!kindFilter.includes(modelKind(model))) continue;
      if (model.requiresApiKey === true && !hasCredentials) continue;
      if (isDisabled(alias, model.id)) continue;
      if (hidePaidModels && isPaidModel(`${alias}/${model.id}`)) continue;
      const caps = getCapabilitiesForModel(providerId, model.id);
      const entry = {
        id: `${alias}/${model.id}`,
        object: "model",
        owned_by: alias,
        capabilities: caps,
        ...projectModelPresentation({ model, modelId: model.id, providerId, outputAlias: alias }),
      };
      if (modelKind(model) === LLM_KIND) {
        attachModelLimits(entry, providerId, model.id, caps);
      }
      models.push(entry);
    }
  };

  // Custom-model capability overrides — one map for all combo aggregations
  // (no per-member DB reads). Keys are canonical `providerId/modelId`;
  // aggregateComboCapabilities normalizes member prefixes (static alias OR a
  // connection's custom output prefix) through aliasToProviderId before
  // lookup, so `myproxy/model` finds a row stored under the provider alias.
  const customCapsById = new Map(
    customModels.
    filter((m) => m?.id && m?.providerAlias && (m.kind || m.type || "llm") === "llm" && m?.capabilities && isObject(m.capabilities)).
    map((m) => [`${aliasToProviderId[m.providerAlias] ?? m.providerAlias}/${m.id}`, m.capabilities])
  );
  // Capability aggregation accepts model IDs only; legacy members remain
  // visibility evidence but cannot contribute capabilities.
  const capabilityComboByName = Object.fromEntries(
    Object.entries(comboByName).map(([name, members]) => [name, members.filter(isString)])
  );

  // Combos first (filtered by kind). Web combos expose `kind` so AI knows search vs fetch.
  for (const combo of combos) {
    if (!comboMatchesKinds(combo, kindFilter)) continue;
    // #6495 / F-4: filter combo pools to free/unknown members when the toggle
    // is on; omit combos whose members are all paid. Resolves nested combo
    // names via comboByName with a visited set so cyclic/deeper combos can't
    // loop or leak all-paid pools. Persisted combo objects are untouched.
    const visibleMembers = visibleComboMembers(combo, comboByName, hidePaidModels);
    if (hidePaidModels && visibleMembers.length === 0) continue;
    const entry = comboToEntry(combo);
    if (!entry.kind) {
      const comboCaps = aggregateComboCapabilities(visibleMembers.filter(isString), capabilityComboByName, aliasToProviderId, 0, customCapsById);
      if (comboCaps) {
        entry.capabilities = comboCaps;
        /**
         * Expose the same proven flat token limits as individual LLM models.
         * Combo aggregation already applies member-safe minima and resolves
         * nested combos, static aliases, and custom connection prefixes.
         */
        if ((combo.kind ?? LLM_KIND) === LLM_KIND) {
          attachModelLimits(entry, null, combo.name, {
            ...comboCaps,
            customKeys: new Set(["contextWindow", "maxOutput"])
          });
        }
      }
    }
    models.push(entry);
  }

  for (const customModel of customModels) {
    if (!customModel.id || (customModel.kind || customModel.type) && (customModel.kind || customModel.type) !== "llm") continue;
    if (!kindFilter.includes(LLM_KIND)) continue;
    const providerAlias = customModel.providerAlias;
    if (!providerAlias) continue;

    const modelId = String(customModel.id).trim();
    if (!modelId) continue;

    const providerId = aliasToProviderId[providerAlias] ?? providerAlias;
    const staticCaps = getCapabilitiesForModel(providerId, modelId);
    const customCaps = isRecord(customModel.capabilities) ? customModel.capabilities : {};
    const entry = {
      id: `${providerAlias}/${modelId}`,
      object: "model",
      owned_by: providerAlias,
      capabilities: { ...staticCaps, ...customCaps },
      ...projectModelPresentation({ model: customModel, modelId, providerId, outputAlias: providerAlias }),
    };
    attachModelLimits(entry, providerId, modelId, customCaps);
    models.push(entry);
  }

  if (!dbAvailable) {
    for (const alias of Object.keys(PROVIDER_MODELS)) {
      const providerId = aliasToProviderId[alias] ?? alias;
      if (isFreeNoAuthDisabled(providerId)) continue;
      addStaticProviderModels(providerId, alias);
    }
  } else {
    const providerResults = await Promise.all(
      Array.from(activeConnectionByProvider.entries()).map(async ([providerId, conn]) => {
        if (!providerMatchesKinds(providerId, kindFilter)) return [];
        if (isFreeNoAuthDisabled(providerId)) return [];

        const staticAlias = PROVIDER_ID_TO_ALIAS[providerId] ?? providerId;
        const prefix = isRecord(conn.providerSpecificData) ? conn.providerSpecificData.prefix : undefined;
        const outputAlias = (
        (isString(prefix) ? prefix : undefined) ||
        getProviderAlias(providerId) ||
        staticAlias).
        trim();
        const providerModels = PROVIDER_MODELS[staticAlias] ?? [];
        const psd = isRecord(conn.providerSpecificData) ? conn.providerSpecificData : {};
        const enabledModels = psd.enabledModels;
        const hasExplicitEnabledModels =
        Array.isArray(enabledModels) && enabledModels.length > 0;
        const isCompatibleProvider =
        isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);
        const liveModelKindById = new Map();
        const liveCapabilitiesById = new Map();
        const liveModelIds = new Set();
        const liveModelById = new Map();

        // Build kind lookup for static models so we can filter even when only IDs are exposed
        const staticModelKindById = new Map(
          providerModels.map((m) => [m.id, modelKind(m)])
        );
        const staticModelById = new Map(providerModels.map((m) => [m.id, m]));
        const hasUsableCredential = conn.id !== "noauth" && [conn.apiKey, conn.accessToken].
        some((value) => isString(value) &&
        value.trim() !== "" &&
        value !== "public" &&
        value !== "sk_durindoor");
        let rawModelIds = hasExplicitEnabledModels ?
        Array.from(
          new Set(
            enabledModels.filter(
              (modelId) => isString(modelId) && modelId.trim() !== ""
            )
          )
        ) :
        providerModels.map((model) => model.id);

        const customModelKindById = new Map();
        const customCapabilitiesById = new Map();
        const customModelById = new Map();
        const customModelIds = customModels.
        filter((m) => {
          if (!m.id) return false;
          const kind = customModelKind(m);
          // imageToText custom models are vision-capable chat models: expose them
          // both in the default LLM list and in /v1/models/image-to-text.
          if (!kindFilter.includes(kind) && !(kind === "imageToText" && kindFilter.includes(LLM_KIND))) return false;
          const alias = m.providerAlias;
          return alias === staticAlias || alias === outputAlias || alias === providerId;
        }).
        map((m) => {
          const modelId = String(m.id).trim();
          const kind = customModelKind(m);
          if (modelId) {
            customModelById.set(modelId, m);
            customModelKindById.set(modelId, kind);
            if (isRecord(m.capabilities)) customCapabilitiesById.set(modelId, m.capabilities);
          }
          return modelId;
        }).
        filter((modelId) => modelId !== "");

        // Live metadata precedence is user override > live upstream > static
        // catalog > default. `explicitCaps` below applies custom/user metadata
        // after live caps; static/default capability resolution is merged first.
        // Generic OpenAI-compatible discovery is cached per endpoint/credential
        // and fail-soft, so upstream errors leave rawModelIds and static caps intact.
        const providerLiveResolver = LIVE_MODEL_RESOLVERS[providerId];
        const registryFetcher = AI_PROVIDERS[providerId]?.modelsFetcher;
        const genericFetcher = registryFetcher && OPENAI_MODELS_FETCHER_TYPES.has(registryFetcher.type) ?
        registryFetcher :
        null;
        const isKimiLiveProvider = KIMI_LIVE_MODEL_PROVIDERS.has(providerId);
        const compatibleLiveResolver = (isCompatibleProvider || genericFetcher || isKimiLiveProvider) && customModelIds.length === 0 ?
        async (connection, liveGuard) => {
          const psd = isRecord(connection.providerSpecificData) ? connection.providerSpecificData : {};
          const proxyOptions = await resolveConnectionProxyConfig(psd);
          return resolveLiveOpenAIModels(connection, {
            provider: providerId,
            guard: liveGuard,
            proxyOptions,
            endpoint: genericFetcher?.url || (isKimiLiveProvider ? KIMI_CODING_MODELS_URL : undefined),
            anthropic: isAnthropicCompatibleProvider(providerId),
            modelAliases: undefined
          });
        } :
        null;
        const liveResolver = providerLiveResolver || compatibleLiveResolver;
        if (liveResolver && (!hasExplicitEnabledModels || providerLiveResolver || compatibleLiveResolver)) {
          try {
            const live = await liveResolver(conn, guard);
            if (live?.models?.length) {
              const enrichExistingOnly = !LIVE_MODEL_UNION_PROVIDERS.has(providerId) && (
              hasExplicitEnabledModels || Boolean(compatibleLiveResolver) || providerId === "cloudflare-ai") &&
              rawModelIds.length > 0;
              const servedIds = new Set(rawModelIds);
              const liveModels = enrichExistingOnly ?
              live.models.filter((m) => servedIds.has(m.id)) :
              live.models;
              // Generic and Cloudflare discovery generally enrich routed IDs only.
              // Union providers, including Groq's generic fetcher, preserve static
              // order and append unknown live IDs; other resolvers expose live IDs.
              if (!hasExplicitEnabledModels) {
                if (LIVE_MODEL_UNION_PROVIDERS.has(providerId)) {
                  rawModelIds = Array.from(new Set([...rawModelIds, ...liveModels.map((m) => m.id)]));
                } else if (!enrichExistingOnly) {
                  rawModelIds = liveModels.map((m) => m.id);
                }
              }
              for (const m of liveModels) {
                if (!isRecord(m) || !isString(m.id)) continue;
                liveModelById.set(m.id, m);
                liveModelIds.add(m.id);
                if (m.kind || m.type) liveModelKindById.set(m.id, m.kind || m.type);
                if (isRecord(m.capabilities)) liveCapabilitiesById.set(m.id, m.capabilities);
              }
            }
          } catch {

            // Live discovery is optional metadata; static catalog remains authoritative fallback.
          }} else if (providerId === "ollama-local" && liveResolver && hasExplicitEnabledModels) {
          // ollama-local only: explicit enabledModels keep the user's
          // selection, but /api/tags still supplies kind metadata so a
          // selected bge-m3 classifies as embedding instead of falling
          // through to the LLM heuristic. Other providers keep their
          // no-network fast path.
          try {
            const live = await liveResolver(conn, guard);
            for (const m of live?.models ?? []) {
              if (!rawModelIds.includes(m.id)) continue;
              liveModelById.set(m.id, m);
              if (m.kind || m.type) liveModelKindById.set(m.id, m.kind || m.type);
              if (isRecord(m.capabilities)) liveCapabilitiesById.set(m.id, m.capabilities);
            }
          } catch (err) {
            console.log(`Live model classification failed for ${providerId}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        // Local passthrough live discovery (lm-studio, vllm, lemonade). Hits
        // transport.baseUrl + /models with optional Bearer apiKey.
        if (
        rawModelIds.length === 0 &&
        AI_PROVIDERS[providerId]?.passthroughModels &&
        !AI_PROVIDERS[providerId]?.modelsFetcher)
        {
          try {
            const localPassthroughIds = await fetchLocalPassthroughModels(conn, guard);
            if (localPassthroughIds.length) rawModelIds = localPassthroughIds;
          } catch (err) {
            console.log(`Local passthrough model fetch failed for ${providerId}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        const modelIds = rawModelIds.
        map((modelId) => {
          if (modelId.startsWith(`${outputAlias}/`)) {
            return modelId.slice(outputAlias.length + 1);
          }
          if (modelId.startsWith(`${staticAlias}/`)) {
            return modelId.slice(staticAlias.length + 1);
          }
          if (modelId.startsWith(`${providerId}/`)) {
            return modelId.slice(providerId.length + 1);
          }
          return modelId;
        }).
        filter((modelId) => isString(modelId) && modelId.trim() !== "");

        const aliasModelIds = Object.values(modelAliases).
        filter((fullModel) => isString(fullModel) && fullModel.includes("/")).
        map((fullModel) => {
          if (fullModel.startsWith(`${outputAlias}/`)) {
            return fullModel.slice(outputAlias.length + 1);
          }
          if (fullModel.startsWith(`${staticAlias}/`)) {
            return fullModel.slice(staticAlias.length + 1);
          }
          if (fullModel.startsWith(`${providerId}/`)) {
            return fullModel.slice(providerId.length + 1);
          }
          return fullModel;
        }).
        filter((modelId) => isString(modelId) && modelId.trim() !== "");

        const mergedModelIds = Array.from(new Set([...modelIds, ...customModelIds, ...aliasModelIds]));
        const perProviderModels = [];

        for (const modelId of mergedModelIds) {
          if (staticModelById.get(modelId)?.requiresApiKey === true && !hasUsableCredential) continue;
          // Resolve kind: prefer custom/live/static metadata, otherwise infer from ID heuristics
          const customKind = customModelKindById.get(modelId);
          const liveKind = liveModelKindById.get(modelId);
          const kind = customKind || liveKind || staticModelKindById.get(modelId) || inferKindFromUnknownModelId(modelId);
          // imageToText custom models stay in the LLM list (vision-capable chat models)
          const allowAsLlm = kind === "imageToText" && kindFilter.includes(LLM_KIND);
          if (!kindFilter.includes(kind) && !allowAsLlm) continue;
          if (isDisabled(outputAlias, modelId) || isDisabled(staticAlias, modelId)) continue;
          // #6495 / F-4: drop paid provider models when the toggle is on.
          // Classify by output alias so provider-specific overrides (gh/…,
          // api-airforce (Free) markers, …) are honored identically to the
          // modal + combo filters.
          if (hidePaidModels && isPaidModel(`${outputAlias}/${modelId}`)) continue;

          const customCaps = {
            ...(capabilitiesFromServiceKind(customKind || liveKind) || {}),
            ...(customCapabilitiesById.get(modelId) || {})
          };
          const liveCaps = liveCapabilitiesById.get(modelId) || null;
          const explicitCaps = { ...(liveCaps || {}), ...customCaps };
          /**
           * Compatible providers reuse proven static family limits even when
           * their UUID-scoped registry has no literal model row. Unknown IDs
           * keep explicit/live metadata only, so generic defaults stay hidden.
           */
          const hasStaticModel = staticModelById.has(modelId);
          // ID-only provider catalogs prove routing, not a model-family limit.
          // Apply pattern fallback to configured/compatible IDs, but never to a
          // newly enumerated MiniMax/GLM ID absent from the static registry.
          const isUncatalogedIdOnlyLiveModel = (
          providerId === "minimax" || providerId === "minimax-cn" ||
          providerId === "glm" || providerId === "glm-cn") &&
          liveModelIds.has(modelId) && !hasStaticModel;
          const hasStaticLimits = hasStaticModel ||
          !isUncatalogedIdOnlyLiveModel && resolveModelLimits(providerId, modelId).known;
          const caps = hasStaticLimits ?
          { ...getCapabilitiesForModel(providerId, modelId), ...explicitCaps } :
          explicitCaps;
          const presentationModel = customModelById.get(modelId)
            || liveModelById.get(modelId)
            || staticModelById.get(modelId)
            || { id: modelId };
          const presentation = projectModelPresentation({
            model: presentationModel,
            modelId,
            providerId,
            outputAlias,
          });
          const model = {
            id: `${outputAlias}/${modelId}`,
            object: "model",
            owned_by: outputAlias,
            capabilities: caps,
            ...presentation,
          };
          if ((kind === LLM_KIND || allowAsLlm) && (hasStaticLimits || Object.keys(explicitCaps).length)) {
            attachModelLimits(model, providerId, modelId, customCaps, liveCaps);
          }
          perProviderModels.push(model);
        }

        // Web search/fetch — provider IS the model, expose as {alias}/search and/or {alias}/fetch with explicit kind
        const providerInfo = AI_PROVIDERS[providerId];
        if (kindFilter.includes("webSearch") && providerInfo?.searchConfig) {
          perProviderModels.push({
            id: `${outputAlias}/search`,
            object: "model",
            kind: "webSearch",
            owned_by: outputAlias
          });
        }
        if (kindFilter.includes("webFetch") && providerInfo?.fetchConfig) {
          perProviderModels.push({
            id: `${outputAlias}/fetch`,
            object: "model",
            kind: "webFetch",
            owned_by: outputAlias
          });
        }

        return perProviderModels;
      })
    );

    for (const result of providerResults) {
      models.push(...result);
    }

    // Keyless catalogs stay visible even when unrelated saved connections
    // exist. A real connection for the same provider already contributes its
    // catalog above and suppresses this synthetic static fallback.
    for (const [providerId, provider] of Object.entries(AI_PROVIDERS)) {
      if (provider?.noAuth !== true || activeConnectionByProvider.has(providerId)) continue;
      if (isFreeNoAuthDisabled(providerId)) continue;
      const alias = PROVIDER_ID_TO_ALIAS[providerId] ?? getProviderAlias(providerId) ?? providerId;
      addStaticProviderModels(providerId, alias);
    }
  }

  /**
   * Final catalog boundary: dynamic/custom metadata can override static caps,
   * so omit structurally impossible ceilings after every source is merged.
   * Source registry objects stay unchanged for separate vendor verification.
   */
  for (const model of models) {
    const caps = model?.capabilities;
    if (!Number.isFinite(caps?.contextWindow) || !Number.isFinite(caps?.maxOutput)) continue;
    if (caps.maxOutput < caps.contextWindow) continue;
    model.capabilities = { ...caps, maxOutput: undefined };
    delete model.max_completion_tokens;
  }

  const dedupedModels = [];
  const seenModelIds = new Set();
  for (const model of models) {
    if (!model?.id || seenModelIds.has(model.id)) continue;
    seenModelIds.add(model.id);
    // #6495 / F-4: backstop filter — catches any path that didn't pre-filter
    // (custom models, alias-backed rows, keyless static fallback). Combos are
    // already member-filtered above; skip them here so an empty/all-paid combo
    // can't be re-hidden by its bare name (unknown → visible).
    if (hidePaidModels && model.owned_by !== "combo" && isPaidModel(model.id)) continue;
    dedupedModels.push(model);
  }

  return dedupedModels;
}

/**
 * Coalescing wrapper for `buildModelsList` (OmniRoute #6440).
 *
 * Concurrent `/v1/models` (and `/v1/models/{kind}`) requests that arrive while
 * the first is still aggregating share a single in-flight promise instead of
 * each re-running provider/combo/catalog aggregation. Keyed by the serialized
 * `kindFilter` so root `["llm"]` and capability filters (e.g. `["image"]`) do
 * not collide. The map entry is deleted in `finally`, so:
 *   - settled results are NEVER cached (next request observes fresh DB state),
 *   - a rejection cannot poison subsequent calls.
 *
 * OmniRoute #6966: live discovery fetches (`resolveLiveOpenAIModels` and
 * `fetchLocalPassthroughModels`) use `guardedProbeFetch` with the same
 * local-first SSRF guard tier as provider connection validation. LAN-local
 * OpenAI-compatible servers remain available under the default guard, while
 * cloud-metadata/link-local destinations and redirect-based SSRF stay blocked.
 * Both fetchers fail soft, so one unavailable provider cannot break the list.
 *
 * @param {string[]} kindFilter - service kinds to include.
 * @param {"none"|"public-only"|"block-metadata"} [guard] - resolved SSRF guard
 *   mode for discovery fetches. Defaults to `getProviderValidationGuard()` so
 *   direct callers (policy catalog, tests) always run guarded; the models
 *   routes pass the same resolution explicitly.
 * @param {{ exposeComboOnly?: boolean }} [options] - internal override for
 *   callers that require the full direct-model catalog.
 * @returns {Promise<object[]>} OpenAI-format model entries.
 */
export function buildModelsList(kindFilter, guard = getProviderValidationGuard(), options = {}) {
  // #6440: store the impl promise itself so concurrent same-kind callers get
  // the SAME reference and the aggregation (whose first await is
  // getProviderConnections) starts in this tick. #6495/F-4 hide-paid filtering
  // is resolved inside the impl, so the flag does not affect the coalescing key
  // and one shared build serves all concurrent same-kind callers consistently.
  // #6966: guard mode and the internal exposure override affect behavior, so
  // both join the coalescing key. Public callers omit the override and retain
  // settings-driven /v1/models behavior.
  const exposureKey = options.exposeComboOnly === undefined ? "settings" : String(options.exposeComboOnly);
  const pendingKey = `${kindFilterKey(kindFilter)}\0${guard}\0${exposureKey}`;
  const existing = modelsInFlight.get(pendingKey);
  if (existing) return existing;

  const promise = buildModelsListImpl(kindFilter, guard, options).finally(() => {
    // Only delete if still the same promise (guards against a stale entry if
    // the map is ever manipulated elsewhere).
    if (modelsInFlight.get(pendingKey) === promise) modelsInFlight.delete(pendingKey);
  });
  modelsInFlight.set(pendingKey, promise);
  return promise;
}
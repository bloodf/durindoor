import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import {
  AI_PROVIDERS,
  getProviderAlias,
  isAnthropicCompatibleProvider,
  isOpenAICompatibleProvider,
  isLocalOllamaProvider,
} from "@/shared/constants/providers";
import { getProviderConnections, getCombos, getCustomModels, getModelAliases } from "@/lib/localDb";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { getSettings } from "@/lib/db/repos/settingsRepo";
import { updateProviderCredentials } from "@/sse/services/tokenRefresh";
import { resolveOllamaLocalHost } from "open-sse/config/providers.js";
import { resolveKiroModels } from "open-sse/services/kiroModels.js";
import { resolveQoderModels } from "open-sse/services/qoderModels.js";
import { resolveCopilotModels } from "open-sse/services/copilotModels.js";
import { resolveClinepassModels } from "open-sse/services/clinepassModels.js";
import { aggregateComboCapabilities, capabilitiesFromServiceKind, getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { isPaidModel } from "open-sse/providers/pricing.js";
import { guardedProbeFetch, getProviderValidationGuard } from "open-sse/utils/outboundUrlGuard.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";

// In-flight request coalescing for `buildModelsList` (OmniRoute #6440):
// concurrent `/v1/models` calls that hit before the first one resolves would
// otherwise each re-run the full provider/combo/catalog aggregation. Map key
// is the serialized kindFilter so `["llm"]` (root) and `["image"]` do not
// collide, but two simultaneous `["llm"]` requests share ONE promise. Only the
// in-flight promise is shared — settled results are NEVER cached (the key is
// deleted in `finally`), so DB/credential changes are observed on the next
// request and a rejection cannot poison future calls.
const modelsInFlight = new Map();

function kindFilterKey(kindFilter) {
  return Array.isArray(kindFilter) ? kindFilter.slice().sort().join("\0") : "";
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
];

function normalizeEmbeddingHaystack(...parts) {
  return parts
    .filter((p) => typeof p === "string")
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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
  const id = typeof model.id === "string" ? model.id : "";
  const name = typeof model.name === "string" ? model.name : "";
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

const LIVE_MODEL_RESOLVERS = {
  kiro: async (conn) => {
    const psd = isRecord(conn.providerSpecificData) ? conn.providerSpecificData : {};
    const proxyOptions = await resolveConnectionProxyConfig(psd);
    const result = await resolveKiroModels({
      accessToken: typeof conn.accessToken === "string" ? conn.accessToken : undefined,
      refreshToken: typeof conn.refreshToken === "string" ? conn.refreshToken : undefined,
      providerSpecificData: psd,
    }, {
      log: console,
      proxyOptions,
      onCredentialsRefreshed: async (refreshed) => {
        if (!refreshed?.accessToken || !conn.id) return;
        await updateProviderCredentials(conn.id, {
          ...refreshed,
          existingProviderSpecificData: psd,
          testStatus: "active",
        });
        conn.accessToken = refreshed.accessToken;
        if (refreshed.refreshToken) conn.refreshToken = refreshed.refreshToken;
        if (isRecord(refreshed.providerSpecificData)) {
          conn.providerSpecificData = {
            ...psd,
            ...refreshed.providerSpecificData,
          };
        }
      },
    });
    if (!result?.models?.length) return null;
    const models = result.models
      .filter((m) => isRecord(m) && typeof m.id === "string")
      .map((m) => {
        const model = { id: m.id };
        if (typeof m.name === "string") model.name = m.name;
        return model;
      });
    return models.length ? { models } : null;
  },
  qoder: async (conn) => {
    const result = await resolveQoderModels({
      accessToken: typeof conn.accessToken === "string" ? conn.accessToken : undefined,
      refreshToken: typeof conn.refreshToken === "string" ? conn.refreshToken : undefined,
      email: typeof conn.email === "string" ? conn.email : undefined,
      displayName: typeof conn.displayName === "string" ? conn.displayName : undefined,
      providerSpecificData: isRecord(conn.providerSpecificData) ? conn.providerSpecificData : {},
    });
    if (!result?.models?.length) return null;
    return {
      models: result.models.map((m) => ({ id: m.id, name: m.name })),
    };
  },
  github: async (conn) => {
    const psd = isRecord(conn.providerSpecificData) ? conn.providerSpecificData : {};
    const proxyOptions = await resolveConnectionProxyConfig(psd);
    const result = await resolveCopilotModels({
      accessToken: typeof conn.accessToken === "string" ? conn.accessToken : undefined,
      refreshToken: typeof conn.refreshToken === "string" ? conn.refreshToken : undefined,
      providerSpecificData: psd,
    }, {
      log: console,
      proxyOptions,
      onCredentialsRefreshed: async (refreshed) => {
        if (!conn.id) return;
        await updateProviderCredentials(conn.id, {
          copilotToken: refreshed.copilotToken,
          copilotTokenExpiresAt: refreshed.copilotTokenExpiresAt,
          existingProviderSpecificData: psd,
        });
      },
    });
    if (!result?.models?.length) return null;
    const models = result.models
      .filter((m) => typeof m.id === "string")
      .map((m) => ({ id: m.id, ...(typeof m.name === "string" ? { name: m.name } : {}) }));
    return models.length ? { models } : null;
  },
  clinepass: async (conn) => {
    const result = await resolveClinepassModels({
      accessToken: typeof conn.accessToken === "string" ? conn.accessToken : undefined,
      apiKey: typeof conn.apiKey === "string" ? conn.apiKey : undefined,
    });
    if (!result?.models?.length) return null;
    const models = result.models
      .filter((m) => typeof m.id === "string")
      .map((m) => ({ id: m.id, ...(typeof m.name === "string" ? { name: m.name } : {}) }));
    return models.length ? { models } : null;
  },
  "ollama-local": async (conn, guard) => {
    const url = `${resolveOllamaLocalHost(conn)}/api/tags`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
      // Route through the connection proxy exactly like the embedding
      // request path does, while keeping the SSRF guard: guardedProbeFetch
      // validates the URL, the injected fetcher carries proxyOptions.
      const psd = isRecord(conn.providerSpecificData) ? conn.providerSpecificData : {};
      const proxyOptions = await resolveConnectionProxyConfig(psd);
      const proxiedFetch = (fetchUrl, init) => proxyAwareFetch(fetchUrl, init, proxyOptions || null);
      const response = await guardedProbeFetch(url, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: controller.signal,
      }, guard, proxiedFetch);
      if (!response.ok) return null;
      const data = await response.json();
      const list = parseOpenAIStyleModels(data);
      if (!Array.isArray(list)) return null;
      const models = list
        .map((m) => {
          if (!isRecord(m)) return null;
          const id = typeof m.id === "string" ? m.id : (typeof m.name === "string" ? m.name : "");
          if (!id) return null;
          const isEmbedding = isOllamaEmbeddingModel(m);
          return { id, name: id, ...(isEmbedding ? { kind: "embedding" } : {}) };
        })
        .filter(Boolean);
      return models.length ? { models } : null;
    } finally {
      clearTimeout(timeoutId);
    }
  },
};

const parseOpenAIStyleModels = (data) => {
  if (Array.isArray(data)) return data;
  if (!isRecord(data)) return [];
  const list = data.data ?? data.models ?? data.results;
  return Array.isArray(list) ? list : [];
};

const OPENAI_MODELS_FETCHER_TYPES = new Set(["openai", "openai-compatible"]);


/**
 * Fetch dynamic model IDs for a provider that exposes `modelsFetcher` in its
 * registry config and has no static models (e.g. qiniu, bai, hackclub). Returns
 * an empty array on any error so callers can fall back to whatever they had.
 */
async function fetchRegistryModelsFetcherIds(connection, guard) {
  const providerId = connection?.provider;
  const provider = providerId ? AI_PROVIDERS[providerId] : null;
  const fetcher = provider?.modelsFetcher;
  if (!fetcher || typeof fetcher.url !== "string" || !OPENAI_MODELS_FETCHER_TYPES.has(fetcher.type)) return [];
  const apiKey = typeof connection.apiKey === "string" ? connection.apiKey : "";
  if (!apiKey) return [];

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    // #6966: SSRF-guarded (local-first) — see buildModelsList JSDoc.
    const response = await guardedProbeFetch(fetcher.url, {
      method: "GET",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: controller.signal,
    }, guard);
    if (!response.ok) return [];
    const data = await response.json();
    const list = Array.isArray(data) ? data : (data?.data ?? data?.models ?? data?.results);
    if (!Array.isArray(list)) return [];
    return Array.from(new Set(
      list
        .map((m) => (isRecord(m) ? (m.id || m.name || m.model) : ""))
        .filter((id) => typeof id === "string" && id.trim() !== "")
    ));
  } catch {
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

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
  video: "video",
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
  if (typeof raw !== "string") return LLM_KIND;
  return MODEL_TYPE_TO_KIND[raw] ?? LLM_KIND;
}

async function fetchCompatibleModelIds(connection, guard) {
  if (typeof connection.apiKey !== "string" || !connection.apiKey) return [];

  const psd = isRecord(connection.providerSpecificData) ? connection.providerSpecificData : {};
  const baseUrlRaw = typeof psd.baseUrl === "string" ? psd.baseUrl.trim().replace(/\/$/, "") : "";

  if (!baseUrlRaw) return [];

  let url = `${baseUrlRaw}/models`;
  const headers = {
    "Content-Type": "application/json",
  };

  if (isOpenAICompatibleProvider(connection.provider)) {
    headers.Authorization = `Bearer ${connection.apiKey}`;
  } else if (isAnthropicCompatibleProvider(connection.provider)) {
    if (url.endsWith("/messages/models")) {
      url = url.slice(0, -9);
    } else if (url.endsWith("/messages")) {
      url = `${url.slice(0, -9)}/models`;
    }
    headers["x-api-key"] = connection.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    headers.Authorization = `Bearer ${connection.apiKey}`;
  } else {
    return [];
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    // #6966: SSRF-guarded (local-first) — see buildModelsList JSDoc.
    const response = await guardedProbeFetch(url, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: controller.signal,
    }, guard);

    if (!response.ok) return [];

    const data = await response.json();
    const rawModels = parseOpenAIStyleModels(data);

    return Array.from(
      new Set(
        rawModels
          .map((model) => {
            if (!isRecord(model)) return "";
            return (typeof model.id === "string" ? model.id : undefined)
              || (typeof model.name === "string" ? model.name : undefined)
              || (typeof model.model === "string" ? model.model : undefined)
              || "";
          })
          .filter((modelId) => typeof modelId === "string" && modelId.trim() !== "")
      )
    );
  } catch {
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
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
  const psdBaseUrl = typeof psd.baseUrl === "string" ? psd.baseUrl.trim().replace(/\/$/, "") : "";
  const defaultBaseUrl = typeof provider.defaultBaseUrl === "string" ? provider.defaultBaseUrl.trim().replace(/\/$/, "") : "";
  const baseUrlRaw = psdBaseUrl || defaultBaseUrl;
  if (!baseUrlRaw) return [];

  const url = `${baseUrlRaw}/models`;
  const headers = { "Content-Type": "application/json" };
  if (typeof connection.apiKey === "string" && connection.apiKey) {
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
      signal: controller.signal,
    }, guard);
    if (!response.ok) return [];
    const data = await response.json();
    const list = Array.isArray(data) ? data : (data?.data ?? data?.models ?? data?.results);
    if (!Array.isArray(list)) return [];
    return Array.from(new Set(
      list
        .map((m) => (isRecord(m) ? (m.id || m.name || m.model) : ""))
        .filter((id) => typeof id === "string" && id.trim() !== "")
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
  const kinds = Array.isArray(serviceKinds) && serviceKinds.length > 0
    ? serviceKinds.filter((k) => typeof k === "string")
    : [LLM_KIND];
  return kindFilter.some((k) => kinds.includes(k));
}

// Combo matches kindFilter when its `kind` field is in the list.
// Combos with no kind are treated as LLM.
function comboMatchesKinds(combo, kindFilter) {
  const kind = combo?.kind ?? LLM_KIND;
  return kindFilter.includes(kind);
}

/**
 * Build OpenAI-format models list filtered by service kinds.
 * @param {string[]} kindFilter - List of service kinds to include (e.g. ["llm"], ["webSearch","webFetch"]).
 * @returns {Promise<object[]>} OpenAI-format model entries.
 */
async function buildModelsListImpl(kindFilter, guard) {
  // Start the real aggregation FIRST so `getProviderConnections()` is called
  // synchronously — required by the #6440 coalescing identity test, which holds
  // the first in-flight promise open via mockReturnValueOnce and asserts it was
  // called exactly once in this tick. Read the #6495/F-4 opt-in concurrently
  // (fail-closed to off so a settings DB error never hides paid models).
  const connectionsPromise = getProviderConnections();
  let hidePaidModels = false;
  try {
    hidePaidModels = (await getSettings())?.hidePaidModels === true;
  } catch (e) {
    hidePaidModels = false;
  }

  let connections = [];
  try {
    connections = await connectionsPromise;
    connections = connections.filter((c) => c.isActive !== false);
  } catch (e) {
    console.log("Could not fetch providers, returning all models");
  }

  let combos = [];
  try {
    combos = (await getCombos()).filter((c) => c !== null);
  } catch (e) {
    console.log("Could not fetch combos");
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
  const comboByName = Object.fromEntries(combos.map((combo) => [combo.name, combo.models || []]));
  // Model ids below are prefixed with outputAlias (static alias or the active
  // connection's custom prefix), so map each exposed alias back to the
  // provider id — needed for combo capability aggregation on ids like
  // `mykr/<model>` whose prefix is not a registered provider alias.
  const aliasToProviderId = Object.fromEntries(
    Object.entries(PROVIDER_ID_TO_ALIAS).map(([id, alias]) => [alias, id]),
  );
  // Overlay active connections so custom prefixes (providerSpecificData.prefix)
  // and the provider's static alias both map back to the provider id. Saved combos
  // may still reference the static alias even after a prefix is configured, and
  // the no-connection fallback catalog also needs the static alias map.
  for (const [providerId, conn] of activeConnectionByProvider) {
    const staticAlias = PROVIDER_ID_TO_ALIAS[providerId] ?? providerId;
    const prefix = isRecord(conn.providerSpecificData) ? conn.providerSpecificData.prefix : undefined;
    const outputAlias = (
      (typeof prefix === "string" ? prefix : undefined)
      || getProviderAlias(providerId)
      || staticAlias
    ).trim();
    aliasToProviderId[outputAlias] = providerId;
    aliasToProviderId[staticAlias] = providerId;
    aliasToProviderId[providerId] = providerId;
  }

  const addStaticProviderModels = (providerId, alias, { hasCredentials = false } = {}) => {
    if (!providerMatchesKinds(providerId, kindFilter)) return;
    for (const model of PROVIDER_MODELS[alias] ?? []) {
      if (!kindFilter.includes(modelKind(model))) continue;
      if (model.requiresApiKey === true && !hasCredentials) continue;
      if (isDisabled(alias, model.id)) continue;
      // #6495 / F-4: drop paid static/keyless provider models when on.
      if (hidePaidModels && isPaidModel(`${alias}/${model.id}`)) continue;
      models.push({
        id: `${alias}/${model.id}`,
        object: "model",
        owned_by: alias,
        capabilities: getCapabilitiesForModel(providerId, model.id),
      });
    }
  };

  // Combos first (filtered by kind). Web combos expose `kind` so AI knows search vs fetch.
  for (const combo of combos) {
    if (!comboMatchesKinds(combo, kindFilter)) continue;
    // #6495 / F-4: filter combo pools to free/unknown members when the toggle
    // is on; omit combos whose members are all paid. Resolves nested combo
    // names via comboByName with a visited set so cyclic/deeper combos can't
    // loop or leak all-paid pools. Persisted combo objects are untouched.
    let visibleMembers = combo.models || [];
    if (hidePaidModels) {
      const comboHasVisibleMember = (name, seen) => {
        if (seen.has(name)) return false;
        const members = comboByName[name];
        if (!Array.isArray(members)) return true; // unknown name → keep
        seen.add(name);
        const ok = members.some((m) => {
          if (typeof m !== "string") return true;
          if (!m.includes("/")) return comboHasVisibleMember(m, seen);
          return !isPaidModel(m);
        });
        seen.delete(name);
        return ok;
      };
      visibleMembers = visibleMembers.filter((member) => {
        if (typeof member !== "string") return true;
        if (!member.includes("/")) return comboHasVisibleMember(member, new Set());
        return !isPaidModel(member);
      });
      if (visibleMembers.length === 0) continue;
    }
    const entry = {
      id: combo.name,
      object: "model",
      owned_by: "combo",
    };
    if (combo.kind === "webSearch" || combo.kind === "webFetch") {
      entry.kind = combo.kind;
    } else {
      const comboCaps = aggregateComboCapabilities(visibleMembers, comboByName, aliasToProviderId);
      if (comboCaps) entry.capabilities = comboCaps;
    }
    models.push(entry);
  }

  if (connections.length === 0) {
    // DB unavailable -> return static models, filtered by per-model kind
    for (const alias of Object.keys(PROVIDER_MODELS)) {
      const providerId = aliasToProviderId[alias] ?? alias;
      addStaticProviderModels(providerId, alias);
    }

    for (const customModel of customModels) {
      if (!customModel.id || ((customModel.kind || customModel.type) && (customModel.kind || customModel.type) !== "llm")) continue;
      // Custom models without active connection are LLM-only by current schema
      if (!kindFilter.includes(LLM_KIND)) continue;
      const providerAlias = customModel.providerAlias;
      if (!providerAlias) continue;

      const modelId = String(customModel.id).trim();
      if (!modelId) continue;

      models.push({
        id: `${providerAlias}/${modelId}`,
        object: "model",
        owned_by: providerAlias,
      });
    }
  } else {
    const providerResults = await Promise.all(
      Array.from(activeConnectionByProvider.entries()).map(async ([providerId, conn]) => {
        if (!providerMatchesKinds(providerId, kindFilter)) return [];

        const staticAlias = PROVIDER_ID_TO_ALIAS[providerId] ?? providerId;
        const prefix = isRecord(conn.providerSpecificData) ? conn.providerSpecificData.prefix : undefined;
        const outputAlias = (
          (typeof prefix === "string" ? prefix : undefined)
          || getProviderAlias(providerId)
          || staticAlias
        ).trim();
        const providerModels = PROVIDER_MODELS[staticAlias] ?? [];
        const psd = isRecord(conn.providerSpecificData) ? conn.providerSpecificData : {};
        const enabledModels = psd.enabledModels;
        const hasExplicitEnabledModels =
          Array.isArray(enabledModels) && enabledModels.length > 0;
        const isCompatibleProvider =
          isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);
        const liveModelKindById = new Map();
        const liveCapabilitiesById = new Map();

        // Build kind lookup for static models so we can filter even when only IDs are exposed
        const staticModelKindById = new Map(
          providerModels.map((m) => [m.id, modelKind(m)])
        );
        const staticModelById = new Map(providerModels.map((m) => [m.id, m]));
        const hasUsableCredential = conn.id !== "noauth" && [conn.apiKey, conn.accessToken]
          .some((value) => typeof value === "string"
            && value.trim() !== ""
            && value !== "public"
            && value !== "sk_durindoor");
        let rawModelIds = hasExplicitEnabledModels
          ? Array.from(
              new Set(
                enabledModels.filter(
                  (modelId) => typeof modelId === "string" && modelId.trim() !== "",
                ),
              ),
            )
          : providerModels.map((model) => model.id);

        if (isCompatibleProvider && rawModelIds.length === 0) {
          // Compatible providers (openai-compatible-*, anthropic-compatible-*) may
          // carry a UUID-v4 suffix in their node ID, which would falsely match
          // the old UUID suffix guard and skip dynamic model discovery. Always
          // attempt a live /models fetch for compatible providers (through the
          // SSRF validation guard).
          rawModelIds = await fetchCompatibleModelIds(conn, guard);
        }

        // Config-driven live catalog override (e.g. Kiro returns dynamic
        // -thinking/-agentic variants per account). On failure, fall back to
        // whatever rawModelIds already holds.
        const liveResolver = LIVE_MODEL_RESOLVERS[providerId];
        if (liveResolver && !hasExplicitEnabledModels) {
          try {
            const live = await liveResolver(conn, guard);
            if (live?.models?.length) {
              rawModelIds = live.models.map((m) => {
                if (m.kind || m.type) liveModelKindById.set(m.id, m.kind || m.type);
                if (isRecord(m.capabilities)) liveCapabilitiesById.set(m.id, m.capabilities);
                return m.id;
              });
            }
          } catch (err) {
            console.log(`Live model fetch failed for ${providerId}: ${err instanceof Error ? err.message : String(err)}`);
          }
        } else if (providerId === "ollama-local" && liveResolver && hasExplicitEnabledModels) {
          // ollama-local only: explicit enabledModels keep the user's
          // selection, but /api/tags still supplies kind metadata so a
          // selected bge-m3 classifies as embedding instead of falling
          // through to the LLM heuristic. Other providers keep their
          // no-network fast path.
          try {
            const live = await liveResolver(conn, guard);
            for (const m of live?.models ?? []) {
              if (!rawModelIds.includes(m.id)) continue;
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
          rawModelIds.length === 0
          && AI_PROVIDERS[providerId]?.passthroughModels
          && !AI_PROVIDERS[providerId]?.modelsFetcher
        ) {
          try {
            const localPassthroughIds = await fetchLocalPassthroughModels(conn, guard);
            if (localPassthroughIds.length) rawModelIds = localPassthroughIds;
          } catch (err) {
            console.log(`Local passthrough model fetch failed for ${providerId}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        // Registry-driven modelsFetcher (e.g. qiniu exposes modelsFetcher in
        // its registry entry). Fires only when no static models and no
        // per-provider live resolver handled the empty case.
        if (
          rawModelIds.length === 0
          && !hasExplicitEnabledModels
          && !liveResolver
          && AI_PROVIDERS[providerId]?.modelsFetcher
        ) {
          try {
            const registryIds = await fetchRegistryModelsFetcherIds(conn, guard);
            if (registryIds.length) rawModelIds = registryIds;
          } catch (err) {
            console.log(`modelsFetcher failed for ${providerId}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        const modelIds = rawModelIds
          .map((modelId) => {
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
          })
          .filter((modelId) => typeof modelId === "string" && modelId.trim() !== "");

        const customModelKindById = new Map();
        const customModelIds = customModels
          .filter((m) => {
            if (!m.id) return false;
            const kind = customModelKind(m);
            // imageToText custom models are vision-capable chat models: expose them
            // both in the default LLM list and in /v1/models/image-to-text.
            if (!kindFilter.includes(kind) && !(kind === "imageToText" && kindFilter.includes(LLM_KIND))) return false;
            const alias = m.providerAlias;
            return alias === staticAlias || alias === outputAlias || alias === providerId;
          })
          .map((m) => {
            const modelId = String(m.id).trim();
            const kind = customModelKind(m);
            if (modelId) customModelKindById.set(modelId, kind);
            return modelId;
          })
          .filter((modelId) => modelId !== "");

        const aliasModelIds = Object.values(modelAliases)
          .filter((fullModel) => typeof fullModel === "string" && fullModel.includes("/"))
          .map((fullModel) => {
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
          })
          .filter((modelId) => typeof modelId === "string" && modelId.trim() !== "");

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

          const caps =
            liveCapabilitiesById.get(modelId)
            || capabilitiesFromServiceKind(customKind || liveKind)
            || getCapabilitiesForModel(providerId, modelId);
          const model = {
            id: `${outputAlias}/${modelId}`,
            object: "model",
            owned_by: outputAlias,
            capabilities: caps,
          };
          perProviderModels.push(model);
        }

        // Web search/fetch — provider IS the model, expose as {alias}/search and/or {alias}/fetch with explicit kind
        const providerInfo = AI_PROVIDERS[providerId];
        if (kindFilter.includes("webSearch") && providerInfo?.searchConfig) {
          perProviderModels.push({
            id: `${outputAlias}/search`,
            object: "model",
            kind: "webSearch",
            owned_by: outputAlias,
          });
        }
        if (kindFilter.includes("webFetch") && providerInfo?.fetchConfig) {
          perProviderModels.push({
            id: `${outputAlias}/fetch`,
            object: "model",
            kind: "webFetch",
            owned_by: outputAlias,
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
      const alias = PROVIDER_ID_TO_ALIAS[providerId] ?? getProviderAlias(providerId) ?? providerId;
      addStaticProviderModels(providerId, alias);
    }
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
 * OmniRoute #6966: every live model-list discovery fetch inside the impl
 * (`fetchCompatibleModelIds`, `fetchLocalPassthroughModels`,
 * `fetchRegistryModelsFetcherIds`) goes through `guardedProbeFetch` with the
 * SAME local-first SSRF guard tier as the provider test-connection path
 * (`getProviderValidationGuard`). A LAN-local OpenAI-compatible provider
 * (e.g. LM Studio on 192.168.x.x) whose connection test passes under the
 * default settings must also have its models listed; cloud-metadata / IPv4
 * link-local endpoints stay blocked before any socket opens, and
 * `redirect: "manual"` closes redirect-based SSRF past the initial-URL check.
 * Blocked endpoints land in each fetcher's `catch { return [] }`, so one bad
 * connection never breaks the aggregated list.
 *
 * @param {string[]} kindFilter - service kinds to include.
 * @param {"none"|"public-only"|"block-metadata"} [guard] - resolved SSRF guard
 *   mode for discovery fetches. Defaults to `getProviderValidationGuard()` so
 *   direct callers (policy catalog, tests) always run guarded; the models
 *   routes pass the same resolution explicitly.
 * @returns {Promise<object[]>} OpenAI-format model entries.
 */
export function buildModelsList(kindFilter, guard = getProviderValidationGuard()) {
  // #6440: store the impl promise itself so concurrent same-kind callers get
  // the SAME reference and the aggregation (whose first await is
  // getProviderConnections) starts in this tick. #6495/F-4 hide-paid filtering
  // is resolved inside the impl, so the flag does not affect the coalescing key
  // and one shared build serves all concurrent same-kind callers consistently.
  // #6966: the guard mode DOES affect behavior (blocked vs allowed discovery
  // fetches), so it is part of the coalescing key — concurrent callers under
  // different policies never share one promise.
  const pendingKey = `${kindFilterKey(kindFilter)}\0${guard}`;
  const existing = modelsInFlight.get(pendingKey);
  if (existing) return existing;

  const promise = buildModelsListImpl(kindFilter, guard).finally(() => {
    // Only delete if still the same promise (guards against a stale entry if
    // the map is ever manipulated elsewhere).
    if (modelsInFlight.get(pendingKey) === promise) modelsInFlight.delete(pendingKey);
  });
  modelsInFlight.set(pendingKey, promise);
  return promise;
}

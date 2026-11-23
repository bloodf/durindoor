import { fetchOpenCodeServerModels } from "open-sse/services/opencodeServer.js";
import { createHash } from "node:crypto";
import { AI_PROVIDERS, isAnthropicCompatibleProvider, isOpenAICompatibleProvider } from "@/shared/constants/providers";
import { materializeSyncedModel } from "@/lib/modelAutoSync/catalog.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { updateProviderCredentials } from "@/sse/services/tokenRefresh";
import { resolveOllamaLocalHost } from "open-sse/config/providers.js";
import { discoverOllamaCatalog } from "open-sse/services/ollamaCatalog.js";
import { resolveKiroModels } from "open-sse/services/kiroModels.js";
import { resolveCommandCodeModels } from "open-sse/services/commandcodeModels.js";
import { resolveQoderModels } from "open-sse/services/qoderModels.js";
import { resolveCursorModels } from "open-sse/services/cursorModels.js";
import { resolveCopilotModels } from "open-sse/services/copilotModels.js";
import { resolveClinepassModels } from "open-sse/services/clinepassModels.js";
import { resolveClineModels } from "open-sse/services/clineModels.js";
import { resolveOpenRouterModels } from "open-sse/services/openrouterCatalog.js";
import { normalizeVeniceModel, resolveLiveAnthropicModels, resolveLiveCloudflareModels, resolveLiveModelIds, resolveLiveOpenAIModels } from "open-sse/services/liveModelLimits.js";
import { extractApiCapabilities, extractLiveModelLimits } from "open-sse/services/modelMetadata.js";
import { getCodexModels } from "open-sse/services/usage/codex.js";
import { guardedProbeFetch } from "open-sse/utils/outboundUrlGuard.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
import { isBoolean, isObject, isString } from "../../../../shared/utils/typeChecks.js";

export function isRecord(value) {
  return value !== null && isObject(value) && !Array.isArray(value);
}

// Per-provider live model resolvers. Each receives a connection record and
// returns { models: [{ id, name? }, ...] } | null on failure.
// Adding a provider here makes /v1/models prefer the live catalog for it.
// Ollama capability classification comes from `/api/show`, not model names.
// Kimi Platform and Kimi Code publish credential-scoped live catalogs.
export const KIMI_LIVE_MODEL_PROVIDERS = new Set(["kimi", "kimi-coding", "kimi-coding-apikey"]);

// ponytail: Keep dedicated-resolver union coverage until every provider declares a registry
// modelsFetcher; then delete this transitional allow-list.
export const LIVE_MODEL_UNION_PROVIDERS = new Set([
"anthropic",
"claude",
"cline",
"chutes",
"codex",
"groq",
"minimax",
"minimax-cn",
"glm",
"glm-cn",
"openrouter"]
);
async function liveResolverOptions(conn) {
  const psd = isRecord(conn.providerSpecificData) ? conn.providerSpecificData : {};
  return {
    provider: conn.provider,
    proxyOptions: await resolveConnectionProxyConfig(psd)
  };
}


// Qoder shares one live resolver across intl (qoder) and CN (qoder-cn); the
// credentials carry the provider id so qoderModels picks the right region's
// catalog endpoint.
async function resolveQoderLiveModels(conn, providerId) {
  const result = await resolveQoderModels({
    provider: providerId,
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
}

/** Keyless LAN nodes get no Authorization or x-api-key header at all. */
function compatibleCatalogHeaders(provider, token) {
  const headers = {};
  if (isAnthropicCompatibleProvider(provider)) {
    headers["anthropic-version"] = "2023-06-01";
    if (token) headers["x-api-key"] = token;
  } else if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

// Runtime context-window fields a compatible node's /models row may carry (port of upstream
// decolua/9router #5808). Only fields describing the window the server will accept are read:
// LM Studio `loaded_context_length`, vLLM `max_model_len`, and OpenRouter-style `context_length`,
// `context_window`, `limit.context`. A model's trained maximum (`max_context_length`, llama.cpp
// `n_ctx_train`) is ignored on purpose: it overstates a smaller loaded window.
export function readCompatibleContextLength(model) {
  const candidates = [
    model?.loaded_context_length,
    model?.max_model_len,
    model?.context_length,
    model?.context_window,
    model?.limit?.context
  ];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return null;
}

// LM Studio's OpenAI-compatible /v1/models returns ids only; the loaded window lives in its native
// GET /api/v0/models (`loaded_context_length`, present only while the model is loaded). The probe goes
// through the same SSRF guard, proxy and credential headers as the catalog fetch. Hosts without that
// endpoint are skipped for 10 minutes. The miss cache is keyed per connection (hash key), never per host,
// so one account's probe state cannot suppress or reveal another's.
const LMSTUDIO_PROBE_MISS_TTL_MS = 10 * 60 * 1000;
const lmStudioProbeMisses = new Map();
async function probeLmStudioLoadedContexts(base, headers, guard, proxy, missKey) {
  if (!/\/v1$/.test(base)) return new Map();
  const missAt = lmStudioProbeMisses.get(missKey);
  if (missAt && Date.now() - missAt < LMSTUDIO_PROBE_MISS_TTL_MS) return new Map();
  try {
    const response = await guardedProbeFetch(`${base.slice(0, -3)}/api/v0/models`, { headers, cache: "no-store", signal: AbortSignal.timeout(3000) }, guard, (url, options) => proxyAwareFetch(url, options, proxy || null));
    if (!response.ok) {
      lmStudioProbeMisses.set(missKey, Date.now());
      return new Map();
    }
    const data = await response.json();
    const rows = Array.isArray(data) ? data : data?.data;
    const contexts = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      const n = Number(row?.loaded_context_length);
      if (isString(row?.id) && Number.isFinite(n) && n > 0) contexts.set(row.id, Math.floor(n));
    }
    lmStudioProbeMisses.delete(missKey);
    return contexts;
  } catch {
    lmStudioProbeMisses.set(missKey, Date.now());
    return new Map();
  }
}

// A reported runtime window becomes a live capability; it outranks the static table (resolveModelLimits
// prefers live over registry) and is overridden by explicit custom-model values. Nothing reported keeps
// the previous behavior exactly.
function withRuntimeContext(row, contextLength) {
  if (!Number.isFinite(contextLength)) return row;
  const capabilities = isRecord(row.capabilities) ? { ...row.capabilities } : {};
  capabilities.contextWindow = contextLength;
  return { ...row, capabilities };
}

// Cache per connection, endpoint and credential so private catalogs never cross accounts.
// Entries live 5 minutes; a failed refresh serves the last-known-good catalog.
const compatibleCatalogCache = new Map();
export async function resolveCompatibleCatalog(conn, guard) {
  const base = conn.providerSpecificData?.baseUrl?.replace(/\/$/, "");
  if (!base) return null;
  const token = conn.apiKey || conn.accessToken || "";
  const key = createHash("sha256").update(JSON.stringify([conn.id, conn.provider, base, token, conn.providerSpecificData, guard])).digest("hex");
  const cached = compatibleCatalogCache.get(key);
  if (cached && Date.now() - cached.time < 300000) return cached.value;
  try {
    const headers = compatibleCatalogHeaders(conn.provider, token);
    const proxy = await resolveConnectionProxyConfig(conn.providerSpecificData || {});
    const response = await guardedProbeFetch(`${base}/models`, { headers, cache: "no-store", signal: AbortSignal.timeout(5000) }, guard, (url, options) => proxyAwareFetch(url, options, proxy || null));
    if (!response.ok) return cached?.value || null;
    const data = await response.json();
    const rows = Array.isArray(data) ? data : data?.data;
    if (!Array.isArray(rows)) return cached?.value || null;
    let models = rows.map((row) => isString(row) ? { id: row } : row).filter((row) => isString(row?.id) && row.id.trim());
    models = models.map((row) => withRuntimeContext(row, readCompatibleContextLength(row)));
    const reportsWindow = models.some((row) => Number.isFinite(row.capabilities?.contextWindow));
    if (!reportsWindow && models.length > 0 && isOpenAICompatibleProvider(conn.provider)) {
      const loaded = await probeLmStudioLoadedContexts(base, headers, guard, proxy, key);
      if (loaded.size > 0) models = models.map((row) => withRuntimeContext(row, loaded.get(row.id)));
    }
    const value = { models };
    compatibleCatalogCache.set(key, { time: Date.now(), value });
    return value;
  } catch {
    return cached?.value || null;
  }
}

export const LIVE_MODEL_RESOLVERS = {
  compatible: resolveCompatibleCatalog,
  chutes: async (conn, guard) => resolveLiveOpenAIModels(conn, {
    ...(await liveResolverOptions(conn)), guard, endpoint: "https://llm.chutes.ai/v1/models"
  }),
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
  "minimax-cn": async (conn, guard) => resolveLiveModelIds(conn, "https://api.minimax.cn/v1/models", {
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
      return [materializeSyncedModel("codex", {
        id,
        name: entry.display_name || id,
        kind: "llm",
        capabilities: extractApiCapabilities(entry),
      })];
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
  commandcode: async (conn) => {
    if (!conn.apiKey) return null;
    const { proxyOptions } = await liveResolverOptions(conn);
    return resolveCommandCodeModels((url, options) => proxyAwareFetch(url, options, proxyOptions));
  },
  cursor: async (conn) => {
    const result = await resolveCursorModels({
      accessToken: isString(conn.accessToken) ? conn.accessToken : undefined,
      providerSpecificData: isRecord(conn.providerSpecificData) ? conn.providerSpecificData : {}
    }, { ...(await liveResolverOptions(conn)) });
    if (!result?.models?.length) return null;
    return { models: result.models.map((m) => ({ id: m.id, name: m.name })) };
  },
  qoder: (conn) => resolveQoderLiveModels(conn, "qoder"),
  "qoder-cn": (conn) => resolveQoderLiveModels(conn, "qoder-cn"),
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
  // Without an explicit selection, list OpenRouter's free models; with one,
  // the whole public catalog only enriches the selected IDs' capabilities.
  openrouter: async (conn) => {
    const enabled = isRecord(conn.providerSpecificData) ? conn.providerSpecificData.enabledModels : null;
    const models = await resolveOpenRouterModels({ freeOnly: !(Array.isArray(enabled) && enabled.length > 0) });
    return models?.length ? { models } : null;
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
  "opencode-server": fetchOpenCodeServerModels,
  "ollama-local": async (conn, guard) => {
    const host = resolveOllamaLocalHost(conn);
    const psd = isRecord(conn.providerSpecificData) ? conn.providerSpecificData : {};
    const proxyOptions = await resolveConnectionProxyConfig(psd);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
      return await discoverOllamaCatalog({ host, accountId: conn.id || "", fetchImpl: (path, init) => guardedProbeFetch(`${host}${path}`, { ...init, cache: "no-store", signal: controller.signal }, guard, (url, options) => proxyAwareFetch(url, options, proxyOptions || null)) });
    } finally {
      clearTimeout(timeoutId);
    }
  },
  typesafe: async (conn, guard) => resolveLiveOpenAIModels(conn, {
    ...(await liveResolverOptions(conn)), provider: "typesafe", guard, endpoint: "https://api.typesafe.ai/v1/models",
    normalizeModel: (model) => {
      const id = isString(model?.name) ? model.name : "";
      return id ? { ...model, id, kind: "systemone" } : null;
    }
  }),
  venice: async (conn, guard) => resolveLiveOpenAIModels(conn, {
    ...(await liveResolverOptions(conn)), provider: "venice", guard, endpoint: "https://api.venice.ai/api/v1/models",
    normalizeModel: normalizeVeniceModel
  })
};

const parseOpenAIStyleModels = (data) => {
  if (Array.isArray(data)) return data;
  if (!isRecord(data)) return [];
  const list = data.data ?? data.models ?? data.results;
  return Array.isArray(list) ? list : [];
};

export function normalizeKimiPlatformModel(model) {
  if (!isRecord(model) || !isString(model.id) || !model.id) return null;
  const capabilities = {
    ...extractLiveModelLimits(model),
    ...(isBoolean(model.supports_image_in) ? { vision: model.supports_image_in } : null),
    ...(isBoolean(model.supports_video_in) ? { videoInput: model.supports_video_in } : null),
    ...(isBoolean(model.supports_reasoning) ? { reasoning: model.supports_reasoning } : null),
  };
  return { id: model.id, ...(Object.keys(capabilities).length ? { capabilities } : null) };
}

export const OPENAI_MODELS_FETCHER_TYPES = new Set(["openai", "openai-compatible"]);



// LLM kind sentinel — combos/models with no explicit kind default to LLM
export async function fetchLocalPassthroughModels(connection, guard) {
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

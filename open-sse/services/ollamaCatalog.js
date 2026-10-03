import { isString } from "../../src/shared/utils/typeChecks.js";
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 256;
const cache = new Map();
const inFlight = new Map();
const lastKnownGood = new Map();
const observedContexts = new Map();

function list(data) {
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.models) ? data.models : [];
}

function positive(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function modelId(model) {
  return [model?.id, model?.name, model?.model].find((value) => isString(value) && value.trim())?.trim() || "";
}

function capabilities(model) {
  return new Set(Array.isArray(model?.capabilities) ? model.capabilities.filter((value) => isString(value)) : []);
}

// Older daemons omit capabilities. Preserve their embedding-family fallback;
// an explicit completion/embedding declaration always takes precedence.
export function isLegacyOllamaEmbeddingModel(model) {
  const parts = [model?.id, model?.name, model?.model, model?.details?.family,
    ...(Array.isArray(model?.details?.families) ? model.details.families : [])];
  const text = parts.filter((value) => isString(value)).join(" ").toLowerCase();
  if (text.includes("embed")) return true;
  const normalized = text.replace(/[^a-z0-9]+/g, " ");
  return /\b(?:bge|minilm|nomic embed|mxbai embed|snowflake arctic embed|all minilm|e5|gte)\b/.test(normalized);
}

function cached(key) {
  const value = cache.get(key);
  if (!value || value.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return value.value;
}

function store(map, key, value, expiresAt = null) {
  if (map.size >= CACHE_MAX_ENTRIES) map.delete(map.keys().next().value);
  map.set(key, expiresAt ? { value, expiresAt } : value);
}

export function getOllamaCatalogModel(host, accountId, model) {
  return lastKnownGood.get(`${host}\0${accountId || ""}\0${model}`) || null;
}

/** `/api/ps` is sole source for served context; fetchImpl enforces caller policy. */
export async function discoverOllamaCatalog({ host, accountId = "", fetchImpl }) {
  const scope = `${host}\0${accountId}`;
  const catalogKey = `${scope}\0catalog`;
  if (inFlight.has(catalogKey)) return inFlight.get(catalogKey);
  const request = (async () => {
    try {
      const [tagsResponse, psResponse] = await Promise.all([
        fetchImpl("/api/tags", { method: "GET" }),
        fetchImpl("/api/ps", { method: "GET" }).catch(() => null),
      ]);
      if (!tagsResponse?.ok) throw new Error("Ollama model list unavailable");
      const [tags, running] = await Promise.all([tagsResponse.json(), psResponse?.ok ? psResponse.json() : Promise.resolve(null)]);
      const servedContexts = new Map(list(running).map((model) => [modelId(model), positive(model?.context_length)]));
      const models = [];
      for (const tag of list(tags)) {
        const id = modelId(tag);
        if (!id) continue;
        const modelKey = `${scope}\0${id}`;
        const contextKey = `${modelKey}\0context`;
        const currentContext = servedContexts.get(id);
        if (currentContext) {
          store(cache, contextKey, currentContext, Date.now() + CACHE_TTL_MS);
          store(observedContexts, contextKey, currentContext);
        }
        let declared = capabilities(tag);
        if (!declared.size) {
          try {
            const response = await fetchImpl("/api/show", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: id }) });
            if (response?.ok) declared = capabilities(await response.json());
          } catch {
            // Tags stay membership source; cached enrichment below remains usable.
          }
        }
        const previous = cached(modelKey) || lastKnownGood.get(modelKey);
        const contextWindow = currentContext ?? cached(contextKey) ?? observedContexts.get(contextKey);
        const model = {
          id,
          name: isString(tag.name) && tag.name.trim() ? tag.name : id,
          ...(declared.has("embedding") && !declared.has("completion") ? { kind: "embedding" } : declared.size ? { kind: "llm" } : previous?.kind ? { kind: previous.kind } : isLegacyOllamaEmbeddingModel(tag) ? { kind: "embedding" } : null),
          ...(declared.size ? { capabilities: { tools: declared.has("tools"), vision: declared.has("vision"), ...(contextWindow ? { contextWindow } : null) } } : previous?.capabilities ? { capabilities: { ...previous.capabilities, ...(contextWindow ? { contextWindow } : null) } } : contextWindow ? { capabilities: { contextWindow } } : null),
        };
        store(cache, modelKey, model, Date.now() + CACHE_TTL_MS);
        store(lastKnownGood, modelKey, model);
        models.push(model);
      }
      store(cache, catalogKey, models, Date.now() + CACHE_TTL_MS);
      store(lastKnownGood, catalogKey, models);
      return { models, source: "live", degraded: false };
    } catch {
      const models = cached(catalogKey) || lastKnownGood.get(catalogKey) || [];
      return models.length ? { models, source: "cache", degraded: true, warning: "Ollama discovery failed; using last known catalog." } : { models: [], source: "unavailable", degraded: true, warning: "Ollama discovery failed." };
    }
  })();
  inFlight.set(catalogKey, request);
  try {
    return await request;
  } finally {
    if (inFlight.get(catalogKey) === request) inFlight.delete(catalogKey);
  }
}

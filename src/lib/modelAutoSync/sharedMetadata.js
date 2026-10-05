import { getCachedSharedModelMetadata, saveCachedSharedModelMetadata } from "@/lib/localDb";
import { extractApiCapabilities } from "open-sse/services/modelMetadata.js";
import { isObject, isString } from "../../shared/utils/typeChecks.js";
import { classifyModelKind } from "./catalog.js";

const VERSION = 1;
const TTL_MS = 24 * 60 * 60 * 1000;
const SOURCE_URL = "https://models.dev/api.json";
const PROVIDER_SOURCES = {
  openai: "openai",
  codex: "openai-codex",
  anthropic: "anthropic",
  claude: "anthropic",
  kimi: "moonshotai",
  "kimi-coding": "kimi-for-coding",
  "kimi-coding-apikey": "kimi-for-coding",
  minimax: "minimax",
  "minimax-cn": "minimax-cn",
  xai: "xai",
  gemini: "google",
  github: "github-copilot",
};
const isRecord = (value) => value !== null && isObject(value) && !Array.isArray(value);
const validTimestamp = (value) => Number.isSafeInteger(value) && value >= 0;
let inFlight = null;

function normalizeProviderModels(rawModels) {
  const models = Object.create(null);
  if (!isRecord(rawModels)) return models;
  for (const [id, raw] of Object.entries(rawModels)) {
    if (!id.trim() || !isRecord(raw)) continue;
    const caps = extractApiCapabilities(raw);
    if (Object.keys(caps).length) {
      const kind = classifyModelKind(id, raw);
      models[id] = { ...caps, ...(kind !== "llm" && (raw.kind === kind || raw.type === kind) ? { kind } : null) };
    }
  }
  return models;
}

function modelProvenance(snapshot, provider, id) {
  const metadata = snapshot?.modelMetadata?.[provider]?.[id];
  const source = isRecord(metadata) ? metadata.source : snapshot?.source;
  const fetchedAt = isRecord(metadata) ? metadata.fetchedAt : snapshot?.fetchedAt;
  return {
    ...(isString(source) && source.trim() ? { source } : null),
    ...(validTimestamp(fetchedAt) ? { fetchedAt } : null),
  };
}

/** Read only cached data: model-list requests never trigger a catalog download. */
export async function getSharedModelMetadata() {
  try {
    const snapshot = await getCachedSharedModelMetadata();
    if (snapshot?.version !== VERSION || !validTimestamp(snapshot.fetchedAt) || !isRecord(snapshot.providers)) return null;
    const providers = Object.create(null);
    const modelMetadata = Object.create(null);
    for (const provider of Object.keys(PROVIDER_SOURCES)) {
      const models = normalizeProviderModels(snapshot.providers[provider]);
      if (!Object.keys(models).length) continue;
      providers[provider] = models;
      modelMetadata[provider] = Object.fromEntries(Object.keys(models).map((id) => [id, modelProvenance(snapshot, provider, id)]));
    }
    if (!Object.keys(providers).length) return null;
    return {
      version: VERSION,
      ...(isString(snapshot.source) && snapshot.source.trim() ? { source: snapshot.source } : null),
      fetchedAt: snapshot.fetchedAt,
      providers,
      modelMetadata,
    };
  } catch {
    return null;
  }
}

/** Enrichment only: a shared catalog never grants model access or adds a provider. */
export function normalizeSharedModelMetadata(data) {
  const providers = Object.create(null);
  if (!isRecord(data)) return providers;
  for (const [provider, sourceId] of Object.entries(PROVIDER_SOURCES)) {
    const models = normalizeProviderModels(data[sourceId]?.models);
    // Codex may share API specifications, but its own model-scoped declarations
    // remain distinct. No source endpoints, headers or availability are imported.
    if (provider === "codex") {
      const apiModels = normalizeProviderModels(data.openai?.models);
      for (const [id, caps] of Object.entries(apiModels)) models[id] = { ...caps, ...models[id] };
    }
    if (Object.keys(models).length) providers[provider] = models;
  }
  return providers;
}

/** Refresh on the sync schedule; unusable replies retain the previous snapshot. */
export async function refreshSharedModelMetadata({ now = Date.now(), force = false, fetchCatalog = globalThis.fetch } = {}) {
  while (inFlight) {
    if (!force || inFlight.force) return inFlight.promise;
    // A manual refresh must not be swallowed by a scheduled cache-only read.
    await inFlight.promise;
  }
  const task = { force, promise: null };
  task.promise = (async () => {
    const cached = await getSharedModelMetadata();
    if (!force && cached && now >= cached.fetchedAt && now - cached.fetchedAt < TTL_MS) return cached;
    try {
      const response = await fetchCatalog(SOURCE_URL, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return cached;
      const fresh = normalizeSharedModelMetadata(await response.json());
      if (!Object.keys(fresh).length) return cached;
      const providers = { ...cached?.providers };
      const modelMetadata = { ...cached?.modelMetadata };
      for (const [provider, models] of Object.entries(fresh)) {
        providers[provider] = { ...providers[provider], ...models };
        modelMetadata[provider] = { ...modelMetadata[provider] };
        for (const id of Object.keys(models)) modelMetadata[provider][id] = { source: SOURCE_URL, fetchedAt: now };
      }
      const snapshot = { version: VERSION, source: SOURCE_URL, fetchedAt: now, providers, modelMetadata };
      await saveCachedSharedModelMetadata(snapshot);
      return snapshot;
    } catch {
      return cached;
    }
  })().finally(() => { if (inFlight === task) inFlight = null; });
  inFlight = task;
  return task.promise;
}

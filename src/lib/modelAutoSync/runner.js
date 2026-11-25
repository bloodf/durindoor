import {
  getProviderConnections,
  getSettings,
  getCombos,
  getModelAliases,
  getCustomModels,
  getSyncedModelCatalog,
  getSyncedModelCatalogs,
  saveSyncedModelCatalog
} from "@/lib/localDb";
import { AI_PROVIDERS, getProviderByAlias } from "@/shared/constants/providers";
import { getModelsByProviderId } from "@/shared/constants/models";
import { checkAndRefreshToken } from "@/sse/services/tokenRefresh";
import { PROVIDER_MODELS_CONFIG } from "@/app/api/providers/[id]/models/modelsConfig.js";
import { fetchConnectionModels } from "@/app/api/providers/[id]/models/fetchConnectionModels.js";
import { sanitizeErrorMessage } from "open-sse/utils/error.js";
import { isString } from "@/shared/utils/typeChecks.js";
import { refreshSharedModelMetadata } from "./sharedMetadata.js";
import { autoPruneStaleComboSteps, providerModelPrefixes } from "./staleComboSteps.js";
import {
  effectiveSyncedModels,
  findPrunedReferences,
  getModelAutoSyncIntervalHours,
  catalogEntryForConnection,
  connectionCatalogKey,
  connectionEndpoint,
  isConnectionScopedSyncProvider,
  isModelAutoSyncEnabled,
  isSyncDue,
  markSyncFailure,
  mergeSyncedCatalog,
  normalizeSyncedModels
} from "./catalog.js";

export const MODEL_AUTO_SYNC_FETCH_TIMEOUT_MS = 30_000;

// OpenRouter keeps its own public live catalog (free-model rules) and
// OrcaRouter's catalog is capability-scoped; neither is a plain list to sync.
// ollama-local is a local server that /v1/models already reads live.
// Token Harbor catalogs belong to individual keys, not a provider-wide snapshot.
// DemonRoute's catalog is account-scoped for the same reason. Cloudflare discovery
// lists chat and image models only, so a synced list would hide its other models.
const NOT_SYNCABLE = new Set(["openrouter", "orcarouter", "ollama-local", "tokenharbor", "demonroute", "cloudflare-ai"]);

/** Providers with a list-models path the sync service can call. */
export function isModelAutoSyncEligible(providerId) {
  if (!isString(providerId) || NOT_SYNCABLE.has(providerId)) return false;
  return Boolean(PROVIDER_MODELS_CONFIG[providerId]) || isString(AI_PROVIDERS[providerId]?.modelsFetcher?.url);
}

export { providerModelPrefixes };

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function prepareConnection(providerId, connection) {
  try {
    // Refresh an expiring OAuth token (and GitHub's Copilot token) first; the
    // refreshed credentials are persisted by checkAndRefreshToken itself.
    return { ...connection, ...(await checkAndRefreshToken(providerId, connection)) };
  } catch {
    return connection;
  }
}

/**
 * Report combo members and model aliases whose model the effective synced
 * lists no longer contain. Pruning never rewrites them.
 * @returns {Promise<{ combos: Record<string, string[]>, aliases: Record<string, string> }>}
 */
export async function getPrunedModelReferences(settings = null) {
  const resolvedSettings = settings || await getSettings();
  const [catalogs, combos, modelAliases, customModels] = await Promise.all([
    getSyncedModelCatalogs(), getCombos(), getModelAliases(), getCustomModels()
  ]);
  const providers = [];
  for (const [providerId, entry] of Object.entries(catalogs)) {
    if (!isModelAutoSyncEnabled(providerId, resolvedSettings)) continue;
    const effective = effectiveSyncedModels(entry, getModelsByProviderId(providerId), providerId);
    if (!effective) continue;
    const aliases = providerModelPrefixes(providerId);
    providers.push({
      aliases,
      ids: new Set(effective.map((m) => m.id)),
      customIds: new Set(customModels.filter((m) => aliases.includes(m?.providerAlias)).map((m) => m.id))
    });
  }
  return findPrunedReferences({ providers, combos: combos.filter(Boolean), modelAliases });
}

/**
 * Fetch a connection's model list and merge it into `previous`. Throws on any
 * failure so callers can record it and keep the previous catalog.
 */
async function fetchCatalogEntry(providerId, connection, previous, { now, fetchModels, timeoutMs, endpoint = null }) {
  const controller = new AbortController();
  let result;
  try {
    result = await withTimeout((async () => {
      const prepared = await prepareConnection(providerId, connection);
      if (controller.signal.aborted) throw new Error("Catalog refresh timed out");
      return fetchModels(prepared, { signal: controller.signal });
    })(), timeoutMs);
  } finally {
    controller.abort();
  }
  if (result?.error) throw new Error(`${result.status || ""} ${result.error}`.trim());

  const staticModels = getModelsByProviderId(providerId);
  // The native parsers return rows as supplied, including untyped responses.
  // Keep the API protocol when row discriminators are missing or stripped.
  const canonicalProvider = getProviderByAlias(providerId)?.id || providerId;
  const protocol = PROVIDER_MODELS_CONFIG[canonicalProvider]?.type ??
    AI_PROVIDERS[canonicalProvider]?.modelsFetcher?.type ??
    (canonicalProvider === "anthropic" || canonicalProvider === "claude" ? "anthropic" :
      canonicalProvider === "gemini" ? "gemini" : null);
  const format = protocol === "anthropic" || protocol === "claude" ? "anthropic" :
    protocol === "gemini" ? "gemini" : protocol === "openai" ? "generic" : "auto";
  const models = normalizeSyncedModels(result?.models, staticModels, { format });
  // An empty list is never trusted: pruning on it would wipe the provider.
  if (models.length === 0) throw new Error(result?.warning || "Provider returned no models");

  return mergeSyncedCatalog(previous, models, { now, staticModels, connectionId: connection.id, endpoint });
}

/**
 * Sync a connection-scoped provider: every active
 * connection is fetched and stored under its own key, so no connection's
 * model IDs end up in another's catalog. The provider-keyed row is only a
 * status summary (timestamps only); it never carries model IDs, which
 * also replaces any provider-wide catalog stored before the split.
 */
async function syncConnectionScopedProvider(providerId, connections, { now, fetchModels, timeoutMs }) {
  const catalogs = await getSyncedModelCatalogs();
  const perConnection = [];
  for (const connection of connections) {
    const key = connectionCatalogKey(providerId, connection.id);
    const endpoint = connectionEndpoint(providerId, connection);
    // A catalog fetched from another endpoint is not a baseline for this one.
    const previous = catalogEntryForConnection(catalogs, providerId, connection);
    try {
      const entry = await fetchCatalogEntry(providerId, connection, previous, { now, fetchModels, timeoutMs, endpoint });
      await saveSyncedModelCatalog(key, entry);
      perConnection.push({ connectionId: connection.id, status: "synced", entry });
    } catch (error) {
      const message = sanitizeErrorMessage(error?.message || String(error));
      console.log(`[model-auto-sync] ${providerId} (${String(connection.id).slice(0, 8)}) failed, keeping previous catalog: ${message}`);
      try {
        await saveSyncedModelCatalog(key, markSyncFailure(previous || { endpoint, connectionId: connection.id }, message, now));
      } catch {
        // Recording the failure is best effort.
      }
      perConnection.push({ connectionId: connection.id, status: "failed", error: message });
    }
  }
  const synced = perConnection.filter((r) => r.status === "synced");
  const at = new Date(now).toISOString();
  const newModelIds = [...new Set(synced.flatMap((r) => r.entry.newModelIds))];
  const removedModelIds = [...new Set(synced.flatMap((r) => r.entry.removedModelIds))];
  const error = synced.length === 0 ? perConnection.map((r) => r.error).filter(Boolean)[0] || "Sync failed" : null;
  try {
    await saveSyncedModelCatalog(providerId, {
      connectionScoped: true,
      syncedAt: synced.length ? at : null,
      lastAttemptAt: at,
      error,
      newModelIds: [],
      removedModelIds: [],
      models: []
    });
  } catch {
    // The summary is best effort; per-connection catalogs are already stored.
  }
  console.log(`[model-auto-sync] ${providerId}: ${synced.length}/${connections.length} connections synced`);
  if (synced.length === 0) return { providerId, status: "failed", error };
  return {
    providerId,
    status: "synced",
    newModelIds,
    removedModelIds,
    modelCount: synced.reduce((total, r) => total + r.entry.models.length, 0)
  };
}

/**
 * Fetch one provider's model list with its first active connection and store
 * it as the provider's synced catalog. Never throws: a failure is logged and
 * recorded on the entry, and the previous catalog stays in effect. Providers
 * whose models belong to one endpoint (see connectionScope.js) sync every
 * active connection into its own catalog instead.
 *
 * @param {string} providerId
 * @param {{ now?: number, fetchModels?: Function, timeoutMs?: number }} [options]
 * @returns {Promise<{ providerId: string, status: "synced"|"failed"|"skipped", error?: string, newModelIds?: string[], removedModelIds?: string[], modelCount?: number }>}
 */
export async function syncProviderModels(providerId, {
  now = Date.now(),
  fetchModels = fetchConnectionModels,
  timeoutMs = MODEL_AUTO_SYNC_FETCH_TIMEOUT_MS
} = {}) {
  let previous = null;
  try {
    if (!isModelAutoSyncEligible(providerId)) return { providerId, status: "skipped", error: "Provider has no list-models API" };
    const connections = await getProviderConnections({ provider: providerId, isActive: true });
    const connection = connections[0];
    if (!connection) return { providerId, status: "skipped", error: "No active connection" };

    if (isConnectionScopedSyncProvider(providerId)) {
      return await syncConnectionScopedProvider(providerId, connections, { now, fetchModels, timeoutMs });
    }

    previous = await getSyncedModelCatalog(providerId);
    const entry = await fetchCatalogEntry(providerId, connection, previous, { now, fetchModels, timeoutMs });
    await saveSyncedModelCatalog(providerId, entry);
    console.log(`[model-auto-sync] ${providerId}: ${entry.models.length} models, ${entry.newModelIds.length} new, ${entry.removedModelIds.length} removed`);
    return {
      providerId,
      status: "synced",
      newModelIds: entry.newModelIds,
      removedModelIds: entry.removedModelIds,
      modelCount: entry.models.length
    };
  } catch (error) {
    const message = sanitizeErrorMessage(error?.message || String(error));
    console.log(`[model-auto-sync] ${providerId} failed, keeping previous catalog: ${message}`);
    try {
      await saveSyncedModelCatalog(providerId, markSyncFailure(previous, message, now));
    } catch {
      // Recording the failure is best effort.
    }
    return { providerId, status: "failed", error: message };
  }
}

let inFlight = null;

/**
 * Sync every provider that has an active connection and auto-sync on.
 * Scheduled runs only touch providers whose last attempt is older than the
 * interval; `force` (the dashboard "Sync now") ignores the interval. Passing
 * `providerIds` limits the run to those providers and skips the toggle check,
 * so a manual sync of one provider always runs. Concurrent full runs share
 * one run; a provider-scoped run waits for a full run in flight, then runs.
 *
 * @param {{ providerIds?: string[], force?: boolean, now?: number, fetchModels?: Function, fetchCatalog?: Function }} [options]
 */
export async function runModelAutoSync(options = {}) {
  if (Array.isArray(options.providerIds) && options.providerIds.length > 0) {
    if (inFlight) await inFlight.promise.catch(() => {});
    return runModelAutoSyncImpl(options);
  }
  while (inFlight) {
    if (!options.force || inFlight.force) return inFlight.promise;
    await inFlight.promise.catch(() => {});
  }
  const task = { force: !!options.force, promise: null };
  task.promise = runModelAutoSyncImpl(options).finally(() => {
    if (inFlight === task) inFlight = null;
  });
  inFlight = task;
  return task.promise;
}

async function runModelAutoSyncImpl({ providerIds = null, force = false, now = Date.now(), fetchModels, fetchCatalog } = {}) {
  const settings = await getSettings();
  const intervalHours = getModelAutoSyncIntervalHours(settings);
  const explicit = Array.isArray(providerIds) && providerIds.length > 0;
  let candidates = providerIds;
  let connections = [];
  if (!explicit) {
    connections = await getProviderConnections({ isActive: true });
    candidates = [...new Set(connections.map((c) => c.provider))].
    filter((id) => isModelAutoSyncEnabled(id, settings));
  }
  const catalogs = force || explicit ? {} : await getSyncedModelCatalogs();
  const dueProviders = candidates.filter((providerId) => isModelAutoSyncEligible(providerId) &&
    (force || explicit || (intervalHours > 0 && (
      isSyncDue(catalogs[providerId], intervalHours, now) ||
      (isConnectionScopedSyncProvider(providerId) && connections.some((connection) =>
        connection.provider === providerId && !catalogEntryForConnection(catalogs, providerId, connection)))
    ))));
  // Enrich only when a roster is due, or an operator requests a refresh.
  // The HTTP dependency is independent of the roster fetch dependency.
  if (dueProviders.length || force || explicit) {
    await refreshSharedModelMetadata({ now, force: force || explicit, fetchCatalog });
  }

  const results = [];
  for (const providerId of dueProviders) {
    results.push(await syncProviderModels(providerId, { now, ...(fetchModels ? { fetchModels } : null) }));
  }

  if (results.some((r) => r.status === "synced")) {
    try {
      const pruned = await getPrunedModelReferences(settings);
      for (const [combo, members] of Object.entries(pruned.combos)) {
        console.warn(`[model-auto-sync] combo "${combo}" references models no longer listed: ${members.join(", ")}`);
      }
      for (const [alias, target] of Object.entries(pruned.aliases)) {
        console.warn(`[model-auto-sync] alias "${alias}" points at a model no longer listed: ${target}`);
      }
    } catch (error) {
      console.log(`[model-auto-sync] reference check skipped: ${error?.message || error}`);
    }
  }
  // Opt-in only (settings.autoPruneStaleComboSteps); never throws into the sync run.
  try {
    await autoPruneStaleComboSteps({
      settings,
      now,
      syncedProviderIds: results.filter((r) => r.status === "synced").map((r) => r.providerId)
    });
  } catch (error) {
    console.log(`[model-auto-sync] auto-prune skipped: ${error?.message || error}`);
  }
  return results;
}

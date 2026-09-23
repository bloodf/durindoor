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
import { AI_PROVIDERS, getProviderAlias } from "@/shared/constants/providers";
import { getModelsByProviderId, PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import { checkAndRefreshToken } from "@/sse/services/tokenRefresh";
import { PROVIDER_MODELS_CONFIG } from "@/app/api/providers/[id]/models/modelsConfig.js";
import { fetchConnectionModels } from "@/app/api/providers/[id]/models/fetchConnectionModels.js";
import { sanitizeErrorMessage } from "open-sse/utils/error.js";
import { isString } from "@/shared/utils/typeChecks.js";
import {
  effectiveSyncedModels,
  findPrunedReferences,
  getModelAutoSyncIntervalHours,
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
const NOT_SYNCABLE = new Set(["openrouter", "orcarouter", "ollama-local"]);

/** Providers with a list-models path the sync service can call. */
export function isModelAutoSyncEligible(providerId) {
  if (!isString(providerId) || NOT_SYNCABLE.has(providerId)) return false;
  return Boolean(PROVIDER_MODELS_CONFIG[providerId]) || isString(AI_PROVIDERS[providerId]?.modelsFetcher?.url);
}

/** Every prefix a request or combo can use to name this provider's models. */
export function providerModelPrefixes(providerId) {
  return [...new Set([providerId, PROVIDER_ID_TO_ALIAS[providerId], getProviderAlias(providerId)].filter(isString))];
}

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
    const effective = effectiveSyncedModels(entry, getModelsByProviderId(providerId));
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
 * Fetch one provider's model list with its first active connection and store
 * it as the provider's synced catalog. Never throws: a failure is logged and
 * recorded on the entry, and the previous catalog stays in effect.
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

    previous = await getSyncedModelCatalog(providerId);
    const prepared = await prepareConnection(providerId, connection);
    const result = await withTimeout(fetchModels(prepared), timeoutMs);
    if (result?.error) throw new Error(`${result.status || ""} ${result.error}`.trim());

    const models = normalizeSyncedModels(result?.models);
    // An empty list is never trusted: pruning on it would wipe the provider.
    if (models.length === 0) throw new Error(result?.warning || "Provider returned no models");

    const entry = mergeSyncedCatalog(previous, models, {
      now,
      staticModels: getModelsByProviderId(providerId),
      connectionId: connection.id
    });
    await saveSyncedModelCatalog(providerId, entry);
    console.log(`[model-auto-sync] ${providerId}: ${models.length} models, ${entry.newModelIds.length} new, ${entry.removedModelIds.length} removed`);
    return {
      providerId,
      status: "synced",
      newModelIds: entry.newModelIds,
      removedModelIds: entry.removedModelIds,
      modelCount: models.length
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
 * @param {{ providerIds?: string[], force?: boolean, now?: number, fetchModels?: Function }} [options]
 */
export async function runModelAutoSync(options = {}) {
  if (Array.isArray(options.providerIds) && options.providerIds.length > 0) {
    if (inFlight) await inFlight.catch(() => {});
    return runModelAutoSyncImpl(options);
  }
  if (inFlight) return inFlight;
  inFlight = runModelAutoSyncImpl(options).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runModelAutoSyncImpl({ providerIds = null, force = false, now = Date.now(), fetchModels } = {}) {
  const settings = await getSettings();
  const intervalHours = getModelAutoSyncIntervalHours(settings);
  const explicit = Array.isArray(providerIds) && providerIds.length > 0;
  let candidates = providerIds;
  if (!explicit) {
    const connections = await getProviderConnections({ isActive: true });
    candidates = [...new Set(connections.map((c) => c.provider))].
    filter((id) => isModelAutoSyncEnabled(id, settings));
  }
  const catalogs = force || explicit ? {} : await getSyncedModelCatalogs();

  const results = [];
  for (const providerId of candidates) {
    if (!isModelAutoSyncEligible(providerId)) continue;
    if (!force && !explicit && !isSyncDue(catalogs[providerId], intervalHours, now)) continue;
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
  return results;
}

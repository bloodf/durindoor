import { getCombos, getCustomModels, getSyncedModelCatalogs } from "@/lib/localDb";
import { pruneComboSteps } from "@/lib/db/repos/combosRepo.js";
import { getProviderAlias } from "@/shared/constants/providers";
import { getModelsByProviderId, PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import { isString } from "@/shared/utils/typeChecks.js";
import { resetComboRotation, resetComboScoring } from "open-sse/services/combo.js";
import { effectiveSyncedModels } from "./catalog.js";

/** Every prefix a request or combo can use to name this provider's models. */
export function providerModelPrefixes(providerId) {
  return [...new Set([providerId, PROVIDER_ID_TO_ALIAS[providerId], getProviderAlias(providerId)].filter(isString))];
}

/**
 * Providers with a latest successful, non-empty sync. Providers with no
 * successful sync (never synced, failed first sync, connection-scoped summary
 * rows) are absent, so their steps are never stale.
 * @param {Record<string, object>} catalogs
 * @param {object[]} customModels
 * @param {Set<string>|null} only - limit to these provider ids
 */
function liveProviders(catalogs, customModels, only = null) {
  const providers = [];
  for (const [providerId, entry] of Object.entries(catalogs || {})) {
    if (only && !only.has(providerId)) continue;
    const effective = effectiveSyncedModels(entry, getModelsByProviderId(providerId), providerId);
    if (!effective) continue;
    const aliases = providerModelPrefixes(providerId);
    providers.push({
      providerId,
      aliases,
      ids: new Set(effective.map((model) => model.id)),
      customIds: new Set(customModels.filter((model) => aliases.includes(model?.providerAlias)).map((model) => model.id))
    });
  }
  return providers;
}

/** Steps of one combo whose model is missing from its provider's live catalog. */
export function findStaleSteps(combo, providers) {
  const stale = [];
  (Array.isArray(combo?.models) ? combo.models : []).forEach((model, step) => {
    if (!isString(model)) return;
    const slash = model.indexOf("/");
    if (slash <= 0) return;
    const prefix = model.slice(0, slash);
    const modelId = model.slice(slash + 1);
    const owner = providers.find((p) => p.aliases.includes(prefix) && !p.ids.has(modelId) && !p.customIds.has(modelId));
    if (owner) stale.push({ step, model, provider: owner.providerId });
  });
  return stale;
}

/** Stale steps per combo id, for the combo editor's "Not in live catalog" badge. */
export async function getStaleComboSteps({ combos = null } = {}) {
  const [catalogs, customModels, allCombos] = await Promise.all([
    getSyncedModelCatalogs(), getCustomModels(), combos ? Promise.resolve(combos) : getCombos()
  ]);
  const providers = liveProviders(catalogs, customModels);
  const out = {};
  for (const combo of allCombos.filter(Boolean)) {
    const stale = findStaleSteps(combo, providers);
    if (stale.length) out[combo.id] = stale;
  }
  return out;
}

/**
 * Opt-in auto-prune. Runs only when settings.autoPruneStaleComboSteps is true
 * and only against providers that synced successfully (non-empty) in this run.
 * Pruned steps are recorded on the combo and can be restored. A combo is never
 * left with zero steps; it is skipped and logged instead.
 * @param {{ settings: object, syncedProviderIds: string[], now?: number }} input
 */
export async function autoPruneStaleComboSteps({ settings, syncedProviderIds, now = Date.now() }) {
  if (settings?.autoPruneStaleComboSteps !== true) return { enabled: false, pruned: {}, skipped: {} };
  const synced = new Set(syncedProviderIds || []);
  const result = { enabled: true, pruned: {}, skipped: {} };
  if (synced.size === 0) return result;
  const [catalogs, customModels, combos] = await Promise.all([getSyncedModelCatalogs(), getCustomModels(), getCombos()]);
  const providers = liveProviders(catalogs, customModels, synced);
  const prunedAt = new Date(now).toISOString();
  for (const combo of combos.filter(Boolean)) {
    const stale = findStaleSteps(combo, providers);
    if (stale.length === 0 || !isString(combo.id)) continue;
    const outcome = await pruneComboSteps(combo.id, stale, { now: prunedAt });
    if (outcome.skipped === "would-empty") {
      result.skipped[combo.name] = stale.map((s) => s.model);
      console.warn(`[model-auto-sync] combo "${combo.name}" not pruned: every step is stale and a combo keeps at least one`);
    } else if (outcome.pruned.length) {
      result.pruned[combo.name] = outcome.pruned.map((p) => p.model);
      console.warn(`[model-auto-sync] combo "${combo.name}" pruned stale steps (restorable): ${result.pruned[combo.name].join(", ")}`);
      try {
        resetComboRotation(combo.name);
        resetComboScoring(combo.name);
      } catch {
        // Rotation state is rebuilt on the next request.
      }
    }
  }
  return result;
}

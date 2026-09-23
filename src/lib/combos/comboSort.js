/**
 * OmniRoute #11812 (port(omniroute)): combo member sort methods for the
 * dashboard combo builder. `manual` is a no-op (drag-and-drop order); the
 * others are one-shot reorders the operator triggers from
 * `ComboSortSelect` — they write straight back into the combo's existing
 * `models` array, so no new DB column or migration is needed.
 *
 * Members here are plain combo model strings ("provider/model", a bare
 * combo-name reference, or a wildcard entry), matching
 * `src/lib/db/repos/combosRepo.js`'s `models: string[]` shape. Upstream's
 * `score` method ranks by a provider-rankings endpoint the fork does not
 * have (`/api/free-provider-rankings`); skipped here, see AGENTS notes.
 */
import { isString } from "@/shared/utils/typeChecks.js";

export const SORT_METHODS = ["manual", "provider", "name"];
const VALID_SORT_METHODS = new Set(SORT_METHODS);

export function normalizeSortMethod(raw) {
  return VALID_SORT_METHODS.has(raw) ? raw : "manual";
}

/** Provider segment of a combo model string, or "" for a bare combo-name reference. */
function providerKey(model) {
  if (!isString(model)) return "";
  const slash = model.indexOf("/");
  return slash === -1 ? "" : model.slice(0, slash);
}

/**
 * Reorder combo models by the given method. Stable: equal keys keep their
 * original relative order. `manual` returns the array unchanged.
 * @param {string[]} models
 * @param {"manual"|"provider"|"name"} method
 * @returns {string[]}
 */
export function sortComboModels(models, method) {
  if (!Array.isArray(models) || method === "manual") return models;
  const indexed = models.map((model, i) => ({ model, i }));
  indexed.sort((a, b) => {
    const ka = method === "provider" ? providerKey(a.model) : a.model;
    const kb = method === "provider" ? providerKey(b.model) : b.model;
    if (ka !== kb) return ka < kb ? -1 : 1;
    return a.i - b.i;
  });
  return indexed.map((x) => x.model);
}

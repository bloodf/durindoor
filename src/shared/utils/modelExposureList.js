/**
 * Operator-curated model exposure allow/deny list for `/v1/models` and
 * `auto/*` combo candidate pools (OmniRoute #11481, port(omniroute)).
 *
 * Same opt-in shape as `hidePaidModels`: two independent settings arrays,
 * `modelVisibilityAllowlist` / `modelVisibilityDenylist`. An empty entry list
 * always exposes everything (default off, no behavior change). An entry may
 * be an exact catalog id (`"provider/model"` or a bare `"model"`) or a glob
 * pattern using `*`/`?`.
 *
 * This is the single predicate both the `/v1/models` catalog builder
 * (`buildModelsList.js`) and the `auto/*` combo resolver path
 * (`src/sse/services/model.js::getComboModels`) call, so a denied model
 * cannot stay reachable through an auto combo after being hidden from the
 * catalog (the trap already fixed once for `hidePaidModels`, see
 * `buildModelsList.js`'s "#6495 / F-4" comments).
 */
import { isString } from "./typeChecks.js";

function normalizeList(value) {
  return Array.isArray(value) ? value.filter((v) => isString(v) && v.trim() !== "") : [];
}

/** Escape a literal glob segment, then turn `*`/`?` into their regex equivalents. */
function globToRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").
  replace(/\*/g, ".*").
  replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function listMatchesAny(list, candidates) {
  return list.some((entry) => {
    if (candidates.includes(entry)) return true;
    if (!/[*?]/.test(entry)) return false;
    let regex;
    try {
      regex = globToRegex(entry);
    } catch {
      return false;
    }
    return candidates.some((candidate) => regex.test(candidate));
  });
}

/**
 * Whether a (provider, model) pair should be exposed given the operator's
 * allow/deny lists. Denylist wins over an overlapping allow entry; when the
 * allowlist is non-empty, only entries it matches survive.
 * @param {string} provider
 * @param {string} modelId
 * @param {{modelVisibilityAllowlist?: unknown, modelVisibilityDenylist?: unknown}|null|undefined} settings
 * @returns {boolean}
 */
export function isModelExposureAllowed(provider, modelId, settings) {
  const denylist = normalizeList(settings?.modelVisibilityDenylist);
  const allowlist = normalizeList(settings?.modelVisibilityAllowlist);
  if (denylist.length === 0 && allowlist.length === 0) return true;

  const candidates = [modelId, `${provider}/${modelId}`];
  if (listMatchesAny(denylist, candidates)) return false;
  if (allowlist.length === 0) return true;
  return listMatchesAny(allowlist, candidates);
}

/**
 * Filter a list of provider-qualified model strings (`"provider/model"`) by
 * the exposure allow/deny lists. Entries that fail to parse a provider
 * segment are left in place (unknown -> visible, matching `hidePaidModels`'s
 * backstop behavior for unrecognized ids).
 * @param {string[]} modelStrs
 * @param {object|null|undefined} settings
 * @returns {string[]}
 */
export function filterExposedModels(modelStrs, settings) {
  const denylist = normalizeList(settings?.modelVisibilityDenylist);
  const allowlist = normalizeList(settings?.modelVisibilityAllowlist);
  if (denylist.length === 0 && allowlist.length === 0) return modelStrs;
  return modelStrs.filter((modelStr) => {
    if (!isString(modelStr)) return true;
    const slash = modelStr.indexOf("/");
    if (slash === -1) return true;
    const provider = modelStr.slice(0, slash);
    const modelId = modelStr.slice(slash + 1);
    return isModelExposureAllowed(provider, modelId, settings);
  });
}

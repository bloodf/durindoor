/**
 * Auto-combo resolver (Seam 2 of F-2).
 *
 * `auto/<family>` is a virtual combo materialized on demand from the supplied
 * catalog: every installed provider model that belongs to the family becomes a
 * member. Resolution is pure over the catalog — no DB, no IO — so it runs in
 * both the sync (fetch/search) and async (chat/image/tts) dispatch paths. The
 * resolved members then flow through the existing combo strategies; auto-combo
 * adds WHERE the pool comes from, not a new selection algorithm.
 *
 * Contract (assignment F2a2):
 *   resolveAutoCombo(family, catalog, settings) → string[]
 *     family   — bare family name, e.g. "glm" (callers strip the "auto/" prefix)
 *     catalog  — PROVIDER_MODELS-shaped map: { [providerAlias]: Array<{id}|string> }
 *     settings — forwarded, currently unused. Reserved for F2a1's family-helper
 *                interface (settings.comboStrategies[modelStr] =
 *                { judgeModel, strategy, families }); the strategy/judgeModel
 *                then flow downstream through the existing combo path, not here.
 *   Returns provider-qualified member model strings (["glm/glm-5.2", …]).
 *   Empty array (never null) when the family matches zero catalog entries —
 *   callers fail fast on that.
 *
 * Family membership uses the canonical detectModelFamily from autoComboFamilies
 * for id-detectable families (glm/minimax/mimo/gemma/llama/gemini). `zai` is a
 * provider-override family: `auto/zai` pools every model under the `zai` catalog
 * alias (route to the z.ai backend), since no model id derives the `zai` family.
 */

import { MODEL_FAMILIES, detectModelFamily, isProviderOverrideFamily } from "./autoComboFamilies.js";
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";

export const AUTO_COMBO_PREFIX = "auto/";

const MODEL_FAMILY_SET = new Set(MODEL_FAMILIES);
const FAMILY_SEGMENT_RE = /^[a-z0-9]+$/;

function parseFamilySegment(modelStr) {
  if (!isString(modelStr) || !modelStr.startsWith(AUTO_COMBO_PREFIX)) return null;
  const seg = modelStr.slice(AUTO_COMBO_PREFIX.length).toLowerCase();
  // Only the canonical advertised families are valid auto-combo ids: an unknown
  // `auto/<x>` must NOT be treated as a combo (it would fail-fast empty and mask
  // a typo/provider id). Shape check first, then membership.
  if (!FAMILY_SEGMENT_RE.test(seg)) return null;
  return MODEL_FAMILY_SET.has(seg) ? seg : null;
}

/** Is `modelStr` an advertised auto-combo id (`auto/<family>`)? */
export function isAutoComboId(modelStr) {
  return parseFamilySegment(modelStr) !== null;
}

/** Extract the bare family from an `auto/<family>` id (lowercased), else null. */
export function familyOfAutoId(modelStr) {
  return parseFamilySegment(modelStr);
}

// Flatten a PROVIDER_MODELS-shaped catalog into {provider, model} candidates.
// Tolerates both `{ id }` objects and bare strings; skips unknown shapes.
//
// A catalog id is already provider-qualified ONLY when its FIRST segment equals
// the catalog alias it sits under (e.g. `glm/glm-4.7` under alias `glm`). In
// every other case the id is a BARE model id that must be prefixed with the
// alias — even when the id itself contains slashes. Fireworks-style nested ids
// (`accounts/fireworks/models/glm-5p2` under alias `fireworks`) must route as
// `fireworks/accounts/fireworks/models/glm-5p2`, not `accounts/...` with the
// alias dropped.
function catalogToCandidates(catalog) {
  if (!catalog || !isObject(catalog) || Array.isArray(catalog)) return [];
  const out = [];
  for (const [alias, models] of Object.entries(catalog)) {
    if (!Array.isArray(models)) continue;
    for (const entry of models) {
      const id = isString(entry) ? entry : entry?.id;
      if (!isString(id) || id.length === 0) continue;
      const slash = id.indexOf("/");
      if (slash !== -1 && id.slice(0, slash) === alias) {
        // Already `<alias>/<model>` — keep as-is, never double-prefix.
        out.push({ provider: alias, model: id.slice(slash + 1) });
      } else {
        // Bare or nested id — prefix with the owning alias.
        out.push({ provider: alias, model: id });
      }
    }
  }
  return out;
}

/**
 * Resolve a model family to its member model strings.
 * @param {string} family - bare family name, e.g. "glm"
 * @param {Object} [catalog] - { [alias]: Array<{id}|string> }
 * @param {Object} [_settings] - reserved; forwarded for F2a1, currently unused
 * @returns {string[]} provider-qualified members, deduped; [] when none match
 */
export function resolveAutoCombo(family, catalog = {}, _settings) {
  if (!isString(family)) return [];
  family = family.toLowerCase();
  if (!MODEL_FAMILY_SET.has(family)) return [];

  const byProvider = isProviderOverrideFamily(family);
  const seen = new Set();
  const members = [];
  for (const c of catalogToCandidates(catalog)) {
    const matches = byProvider ? c.provider === family : detectModelFamily(c.model) === family;
    if (!matches) continue;
    const qualified = `${c.provider}/${c.model}`;
    if (seen.has(qualified)) continue;
    seen.add(qualified);
    members.push(qualified);
  }
  return members;
}
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
 * Family surface is intentionally minimal: only `glm` is implemented, matched
 * by anchored id-prefix (`glm-*`). Other families and any provider-alias rules
 * arrive with F2a1's canonical helpers — do not add them here.
 *
 * ponytail: family rule lives here (not imported) so this seam ships without
 *   F2a1's combo.js patches. Upgrade path: import F2a1's canonical family
 *   helpers once PATCHES_DONE lands and delete this local rule.
 */

export const AUTO_COMBO_PREFIX = "auto/";

// Family segment: lowercase alnum only. `auto/<family>` matches a model id by
// anchored `${family}-` prefix (e.g. `auto/glm` → `glm-*`). No hardcoded family
// table, no provider-alias rules — F2a1's canonical helpers replace this once
// PATCHES_DONE lands. Anchored prefix (no substring) keeps `glm` from matching
// an id that merely contains "glm".
const FAMILY_SEGMENT_RE = /^[a-z0-9]+$/;

function parseFamilySegment(modelStr) {
  if (typeof modelStr !== "string" || !modelStr.startsWith(AUTO_COMBO_PREFIX)) return null;
  const seg = modelStr.slice(AUTO_COMBO_PREFIX.length).toLowerCase();
  return FAMILY_SEGMENT_RE.test(seg) ? seg : null;
}

/** Is `modelStr` an advertised auto-combo id (`auto/<family>`)? */
export function isAutoComboId(modelStr) {
  return parseFamilySegment(modelStr) !== null;
}

/** Extract the bare family from an `auto/<family>` id (lowercased), else null. */
export function familyOfAutoId(modelStr) {
  return parseFamilySegment(modelStr);
}

function detectModelFamily(modelId, family) {
  if (typeof modelId !== "string" || modelId.trim().length === 0) return false;
  const bare = modelId.includes("/") ? modelId.slice(modelId.lastIndexOf("/") + 1) : modelId;
  return bare.toLowerCase().startsWith(`${family}-`);
}

// Flatten a PROVIDER_MODELS-shaped catalog into {provider, model} candidates.
// Tolerates both `{ id }` objects and bare strings; skips unknown shapes. A
// catalog id that is already provider-qualified (`alias/model`) keeps its own
// provider so we never double-prefix (e.g. `glm/glm-5.2` stays `glm/glm-5.2`).
function catalogToCandidates(catalog) {
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) return [];
  const out = [];
  for (const [alias, models] of Object.entries(catalog)) {
    if (!Array.isArray(models)) continue;
    for (const entry of models) {
      const id = typeof entry === "string" ? entry : entry?.id;
      if (typeof id !== "string" || id.length === 0) continue;
      if (id.includes("/")) {
        const slash = id.indexOf("/");
        out.push({ provider: id.slice(0, slash), model: id.slice(slash + 1) });
      } else {
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
  if (typeof family !== "string") return [];
  family = family.toLowerCase();
  if (!FAMILY_SEGMENT_RE.test(family)) return [];

  const seen = new Set();
  const members = [];
  for (const c of catalogToCandidates(catalog)) {
    if (!detectModelFamily(c.model, family)) continue;
    const qualified = `${c.provider}/${c.model}`;
    if (seen.has(qualified)) continue;
    seen.add(qualified);
    members.push(qualified);
  }
  return members;
}

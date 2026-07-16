/**
 * Context-requirements filtering for combo chat targets.
 *
 * Applies a combo's optional `contextRequirements` config to its member models
 * by context-window size, in TWO coordinated stages around rotation:
 *   1. filterByContextRequirements() — ELIGIBILITY (minContextWindow), runs BEFORE
 *      rotation/scoring so the round-robin pointer, sticky rotation, and
 *      conversation-affinity state are all computed over the eligible pool only.
 *   2. sortByContextSize() — PREFERENCE (preferLargeContext), runs at upstream
 *      #6907's pipeline point: on the rotated/capability-ordered targets,
 *      immediately BEFORE task-aware reordering.
 * Splitting eligibility from preference is required by durindoor's local
 * round-robin/affinity state machinery: a single late filter (upstream's shape)
 * would let the RR pointer land on an excluded member and skew the survivor
 * sequence. The sort placement still matches upstream.
 *
 * Config shape (persisted per-combo at settings.comboStrategies[name].contextRequirements):
 *   {
 *     minContextWindow?: number,         // drop models with context below this
 *     preferLargeContext?: boolean,      // sort survivors by context size (desc)
 *     contextFilterMode?: "strict"|"lenient"  // how to treat unknown-context models
 *   }
 *
 * Filter-mode logic (only when minContextWindow is set):
 *   "lenient" (default): keep known models >= min, keep unknown-context models
 *   "strict":            keep known models >= min, drop unknown-context models
 *   (fail-open: any non-"strict" value — typo, missing, "STRICT" — acts lenient)
 *
 * Sort logic: when preferLargeContext is true, sort by context size descending;
 * unknown-context models sort to the end; the incoming (strategy) order is the
 * tiebreak (stable). Task-aware reordering runs AFTER this step and may reorder
 * the survivors for smart/task strategies; quota ranking runs last.
 *
 * Additive and order-preserving: when no requirement is configured, the SAME
 * array reference is returned unchanged so existing fallback order is intact.
 *
 * IMPORTANT — known-only resolution: this module deliberately does NOT use
 * getCapabilitiesForModel() for context size, because that resolver always
 * merges DEFAULT_CAPABILITIES.contextWindow (=200000) and would make every
 * unknown model look "known". We only trust explicit, authoritative values:
 *   1. the provider registry entry (`models[].contextLength` / `defaultContextLength`)
 *   2. an exact-id or glob-pattern capability that declares `contextWindow`
 * Anything else returns null (unknown) so strict/lenient behaves correctly.
 */

import REGISTRY from "../../providers/registry/index.js";
import {
  PROVIDER_CAPABILITIES,
  MODEL_CAPABILITIES,
  PATTERN_CAPABILITIES,
} from "../../providers/capabilities.js";
import { matchPattern } from "../../providers/pricing.js";

// Alias→entry map for resolving the provider half of a model string.
// REGISTRY is an array keyed by nothing; mirror pricing.js's map (id, alias,
// uiAlias, aliases[]) so "alias/model" and "provider/model" both resolve.
const PROVIDER_BY_ID = {};
for (const entry of REGISTRY) {
  PROVIDER_BY_ID[entry.id] = entry;
  if (entry.alias) PROVIDER_BY_ID[entry.alias] = entry;
  if (entry.uiAlias && entry.uiAlias !== entry.alias) PROVIDER_BY_ID[entry.uiAlias] = entry;
  for (const a of entry.aliases || []) PROVIDER_BY_ID[a] = entry;
}

/**
 * Resolve a model's context window using only explicit/authoritative data.
 * Returns a positive number, or null when the context size is not declared.
 *
 * @param {string} modelStr - full "provider/model" id (or bare model id)
 * @returns {number|null}
 */
export function getKnownContextWindow(modelStr) {
  const slash = typeof modelStr === "string" ? modelStr.indexOf("/") : -1;
  const provider = slash > 0 ? modelStr.slice(0, slash) : "";
  const model = slash > 0 ? modelStr.slice(slash + 1) : String(modelStr || "");
  if (!model) return null;

  const valid = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

  // 1. Provider registry: per-model contextLength, then provider defaultContextLength.
  const entry = provider ? PROVIDER_BY_ID[provider] || null : null;
  if (entry) {
    const list = Array.isArray(entry.models) ? entry.models : [];
    const rec = list.find((m) => m && m.id === model);
    const fromModel = valid(rec?.contextLength);
    if (fromModel !== null) return fromModel;
    const fromDefault = valid(entry.defaultContextLength);
    if (fromDefault !== null) return fromDefault;
  }

  // 2a. Provider-specific capability override declaring contextWindow.
  // Key by the CANONICAL registry id (entry.id), not the raw alias — combo model
  // strings may use an alias while PROVIDER_CAPABILITIES is keyed by registry id.
  const canonicalProvider = entry?.id || provider;
  const fromProvider = valid(PROVIDER_CAPABILITIES?.[canonicalProvider]?.[model]?.contextWindow);
  if (fromProvider !== null) return fromProvider;

  // 2b. Canonical exact-id capability (strip vendor prefix) declaring contextWindow.
  const baseModel = model.includes("/") ? model.split("/").pop() : model;
  const fromExact =
    valid(MODEL_CAPABILITIES?.[baseModel]?.contextWindow) ??
    valid(MODEL_CAPABILITIES?.[model]?.contextWindow);
  if (fromExact !== null) return fromExact;

  // 2c. Glob-pattern capability declaring contextWindow (first match wins).
  for (const { pattern, caps } of PATTERN_CAPABILITIES || []) {
    if (matchPattern(pattern, baseModel) || matchPattern(pattern, model)) {
      const fromPattern = valid(caps?.contextWindow);
      if (fromPattern !== null) return fromPattern;
      break; // matched a pattern that declares no explicit context → treat as unknown
    }
  }

  return null;
}

// Parse + normalize the requirement config. Returns null when no active
// requirement (so callers can keep a same-reference fast path).
function parseRequirements(requirements) {
  if (!requirements || typeof requirements !== "object") return null;
  const { minContextWindow, preferLargeContext, contextFilterMode = "lenient" } = requirements;
  const min =
    typeof minContextWindow === "number" && Number.isFinite(minContextWindow) && minContextWindow > 0
      ? minContextWindow
      : null;
  const prefer = preferLargeContext === true;
  if (min === null && !prefer) return null;
  // Fail-open: only the exact string "strict" opts into strict; any missing /
  // invalid / typo'd value behaves as the documented "lenient" default so an
  // unvalidated settings PATCH can't silently drop unknown-context targets.
  const mode = contextFilterMode === "strict" ? "strict" : "lenient";
  return { min, prefer, mode };
}

/**
 * Eligibility filter: drop models below minContextWindow (strict also drops
 * unknown-context models). Run BEFORE rotation/scoring so the round-robin
 * pointer and affinity state are computed over the ELIGIBLE pool — applying the
 * filter only after rotation would let the pointer land on an excluded member
 * and skew the survivor sequence. Same reference when no filter applies.
 *
 * @param {string[]} models - combo member model ids
 * @param {Object} [requirements] - the combo's contextRequirements config
 * @param {Object} [log] - logger; optional
 * @returns {string[]} eligible models (same reference when no active filter)
 */
export function filterByContextRequirements(models, requirements, log = null) {
  if (!Array.isArray(models) || models.length === 0) return models;
  const req = parseRequirements(requirements);
  if (!req || req.min === null) return models;

  const before = models.length;
  const filtered = models.filter((modelStr) => {
    const ctx = getKnownContextWindow(modelStr);
    if (ctx === null) return req.mode === "lenient"; // unknown handling
    return ctx >= req.min;
  });
  if (filtered.length < before) {
    log?.info?.(
      "COMBO",
      `Context requirements: filtered ${before} → ${filtered.length} targets (minContextWindow: ${req.min}, mode: ${req.mode})`
    );
    log?.debug?.("COMBO", `Context requirements: kept models ${filtered.join(", ")}`);
  }
  return filtered;
}

/**
 * Preference sort: order by context size descending, unknown to the end, with
 * the incoming (strategy) order as the stable tiebreak. Run at upstream #6907's
 * pipeline point — on the rotated/capability-ordered targets, immediately BEFORE
 * task-aware reordering — so preferLargeContext orders the dispatch order while
 * the strategy order stays the tiebreak. Same reference when the preference is off.
 *
 * @param {string[]} models - strategy-ordered combo target ids
 * @param {Object} [requirements] - the combo's contextRequirements config
 * @param {Object} [log] - logger; optional
 * @returns {string[]} sorted models (same reference when preferLargeContext is off)
 */
export function sortByContextSize(models, requirements, log = null) {
  if (!Array.isArray(models) || models.length <= 1) return models;
  const req = parseRequirements(requirements);
  if (!req || !req.prefer) return models;

  const sorted = [...models]
    .map((modelStr, i) => ({ modelStr, i, ctx: getKnownContextWindow(modelStr) }))
    .sort((a, b) => {
      const ac = a.ctx ?? -1; // unknown sorts to the end
      const bc = b.ctx ?? -1;
      return bc - ac || a.i - b.i; // desc by context; stable tiebreak = incoming order
    })
    .map((x) => x.modelStr);
  log?.debug?.(
    "COMBO",
    `Context requirements: sorted by context size (descending): ${sorted
      .map((m) => `${m}(${getKnownContextWindow(m) ?? "unknown"})`)
      .join(", ")}`
  );
  return sorted;
}

/**
 * Convenience: filter + sort in one call (helper-level tests / callers with no
 * separate rotation stage). Combo chat uses the split pair explicitly so the
 * eligibility filter can run before rotation state is computed.
 */
export function applyContextRequirements(models, requirements, log = null) {
  return sortByContextSize(filterByContextRequirements(models, requirements, log), requirements, log);
}

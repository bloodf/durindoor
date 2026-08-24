/**
 * Free Provider Rankings — port of OmniRoute `src/lib/freeProviderRankings.ts`.
 *
 * Classifies which registry providers are usable for free and exposes them in
 * the same shape OmniRoute's dashboard consumes. The intelligence/elo scoring
 * (`topModel.score`, `averageScore`, `eloRaw`, `confidence`) depends on the
 * `model_intelligence` DB table, which DurinDoor does NOT ship. Those fields
 * are therefore emitted as `null` — never fabricated — and ordering uses a
 * deterministic fallback built ONLY from real registry metadata
 * (category → provider id), so the result is stable and never implies a
 * quality ranking we cannot back with data.
 *
 * "Free" here means a provider the router can use without a paid meter:
 *   - `noAuth: true` (local / no-credentials), or
 *   - `category === "freeTier"` or `category === "free"`, or
 *   - every listed model resolves to zero input price via `pricing.js`.
 *
 * Intelligence join is intentionally absent; add it only when the
 * `model_intelligence` table is ported.
 */
import REGISTRY from "../providers/registry/index.js";
import { getPricingForModel } from "../providers/pricing.js";

/**
 * @typedef {Object} ProviderModelScore
 * @property {string} modelId
 * @property {string} modelName
 * @property {number|null} score        null — model_intelligence not ported
 * @property {number|null} eloRaw       null — model_intelligence not ported
 * @property {string|null} confidence   null — model_intelligence not ported
 * @property {string|null} category     null — model_intelligence not ported
 */

/**
 * @typedef {Object} FreeProviderRanking
 * @property {string} id
 * @property {string} name
 * @property {string|null} icon
 * @property {string|null} color
 * @property {string|null} textIcon
 * @property {"noauth"|"oauth"|"apikey"|"freeTier"|"free"} category
 * @property {ProviderModelScore|null} topModel   null — no intelligence data
 * @property {number|null} averageScore           null — no intelligence data
 * @property {number} modelCount                  real registry metadata
 * @property {string} freeReason                  why classified free (real metadata)
 */import { isString } from "@/shared/utils/typeChecks.js";

const MODEL_ID = (m) => isString(m) ? m : m?.id;

function isModelFree(providerId, model) {
  const id = MODEL_ID(model);
  if (!id) return false;
  const pricing = getPricingForModel(providerId, id);
  // No pricing row → treat as free only if the provider itself is free-tier/no-auth
  // (handled by classifyProvider); a priced provider with an unpriced model is NOT free.
  if (!pricing) return false;
  return (pricing.input ?? 0) === 0 && (pricing.output ?? 0) === 0;
}

/**
 * Classify a provider as free and return the reason, or null if paid.
 * @param {object} entry registry entry
 * @returns {{ category: FreeProviderRanking["category"], reason: string } | null}
 */
export function classifyProvider(entry) {
  if (entry?.noAuth) return { category: "noauth", reason: "no-auth" };
  if (entry?.category === "freeTier") return { category: "freeTier", reason: "free-tier" };
  if (entry?.category === "free") return { category: "free", reason: "free-category" };

  const models = Array.isArray(entry?.models) ? entry.models : [];
  if (models.length > 0 && models.every((m) => isModelFree(entry.id, m))) {
    return { category: entry?.category === "oauth" ? "oauth" : "apikey", reason: "zero-priced-models" };
  }
  return null;
}

function modelCount(entry) {
  return Array.isArray(entry?.models) ? entry.models.length : 0;
}

/**
 * Build the rankings list. `topModel`/`averageScore` are null — the
 * `model_intelligence` source OmniRoute joins against is not present here.
 *
 * @param {{ category?: string, limit?: number }} [opts]
 * @returns {FreeProviderRanking[]}
 */
export function computeFreeProviderRankings(opts = {}) {
  const { category, limit = 100 } = opts;
  const rows = [];

  for (const entry of REGISTRY) {
    if (!entry || !entry.id) continue;
    if (!entry.transport && !Array.isArray(entry.models)) continue; // display-only (e.g. "auto")
    const cls = classifyProvider(entry);
    if (!cls) continue;
    if (category && cls.category !== category) continue;

    rows.push({
      id: entry.id,
      name: entry.display?.name || entry.id,
      icon: entry.display?.icon ?? null,
      color: entry.display?.color ?? null,
      textIcon: entry.display?.textIcon ?? null,
      category: cls.category,
      topModel: null,
      averageScore: null,
      modelCount: modelCount(entry),
      freeReason: cls.reason
    });
  }

  // Deterministic fallback order — real metadata only, no quality signal:
  // category (noauth → free/freeTier → oauth → apikey) then provider id.
  const categoryRank = { noauth: 0, free: 1, freeTier: 1, oauth: 2, apikey: 3 };
  rows.sort((a, b) => {
    const ca = categoryRank[a.category] ?? 9;
    const cb = categoryRank[b.category] ?? 9;
    if (ca !== cb) return ca - cb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return rows.slice(0, Math.max(0, limit));
}
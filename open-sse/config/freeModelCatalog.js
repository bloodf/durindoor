// Free-model classifier — DurinDoor port of OmniRoute #6495 (freeModels.ts) on
// top of our `open-sse/config/freeModelCatalog.data.js` FREE_MODEL_BUDGETS.
//
// Contract (matches OmniRoute `shouldHidePaid`):
//   providerHasFreeModels(p)  — does `p` appear in the curated free-tier catalog?
//   isFreeModel(provider, model)
//       true when any of:
//         - model.id ends with `:free` (OpenRouter convention),
//         - model.pricing has prompt===0 AND completion===0 (zero-price),
//         - model.id is listed in FREE_MODEL_BUDGETS for `provider` (or its canonical id).
//
// `isFreeModel` accepts a `pricing` shape in the OmniRoute prompt/completion form;
// our call sites also pass our `providers/pricing.js` rows (`input`/`output` form),
// so `isZeroPricePricing` understands both: explicit `prompt`/`completion` take
// precedence, otherwise fall back to `input`/`output`. Unknown/missing pricing is
// NOT treated as free — only the catalog / :free / explicit-zero signals qualify.
// That matches OmniRoute: a model with pricing metadata and no catalog entry is
// paid even when some ancillary rate happens to be 0.

import { FREE_MODEL_BUDGETS } from "./freeModelCatalog.data.js";

export const PROVIDERS_WITH_FREE_MODELS = new Set(FREE_MODEL_BUDGETS.map((m) => m.provider));

const FREE_MODEL_IDS_BY_PROVIDER = (() => {
  const map = new Map();
  for (const m of FREE_MODEL_BUDGETS) {
    let set = map.get(m.provider);
    if (!set) {
      set = new Set();
      map.set(m.provider, set);
    }
    set.add(m.modelId);
  }
  return map;
})();

/**
 * Whether the given canonical provider id exposes any documented free models.
 * Callers resolve aliases → canonical ids before querying (keeps this module
 * layer-pure: no dependency on the alias map).
 */
export function providerHasFreeModels(providerId) {
  if (typeof providerId !== "string") return false;
  return PROVIDERS_WITH_FREE_MODELS.has(providerId);
}

function isZeroPrice(value) {
  if (typeof value === "number") return value === 0;
  if (typeof value !== "string") return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed === 0;
}

/**
 * True only when pricing explicitly encodes zero-cost prompt AND completion.
 * Accepts both OmniRoute `{ prompt, completion }` and our `{ input, output }`.
 * No-pricing → false (unknown ≠ free).
 */
function isZeroPricePricing(pricing) {
  if (!pricing || typeof pricing !== "object") return false;
  const hasPromptPair = "prompt" in pricing || "completion" in pricing;
  const prompt = hasPromptPair ? pricing.prompt : pricing.input;
  const completion = hasPromptPair ? pricing.completion : pricing.output;
  return isZeroPrice(prompt) && isZeroPrice(completion);
}

/** Whether a single model qualifies as free for the given provider (id or alias). */
export function isFreeModel(provider, model) {
  if (typeof model?.id === "string" && model.id.endsWith(":free")) return true;
  if (isZeroPricePricing(model?.pricing)) return true;
  if (typeof model?.id === "string") {
    return FREE_MODEL_IDS_BY_PROVIDER.get(provider)?.has(model.id) === true;
  }
  return false;
}

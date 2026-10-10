import { isNumber, isObject } from "../../src/shared/utils/typeChecks.js";

/**
 * Internal core-result metadata, never part of the response body. Capture before
 * adapters normalize usage (some synthesize zero tokens). `meta.providerUsage`
 * retains the original receipt and its field path; tokens contain only reported
 * counts. Native-unit pricing is not defined by the token-only pricing contract,
 * so cost remains unknown unless the provider supplies an explicit USD receipt.
 * `state` is pending until a streaming adapter reports success, otherwise complete.
 * Consumers must not commit pending metadata or derive charges from request n.
 */
export function mediaAccounting(value, provider, modality) {
  const record = (v) => v !== null && isObject(v) && !Array.isArray(v);
  const accounting = {
    state: "complete", modality, tokens: {}, nativeUnits: {},
    cost: null, costStatus: "unknown", costSource: "unavailable", meta: {},
  };
  // Preserve native metadata without interpreting undocumented units as USD.
  if (provider === "cohere" && record(value?.meta)) accounting.meta.providerMetadata = { path: "meta", value: value.meta };
  if (provider === "minimax" && record(value?.metadata)) accounting.meta.providerMetadata = { path: "metadata", value: value.metadata };
  const sources = provider === "cohere" ? [["meta.tokens", value?.meta?.tokens]] :
    provider === "gemini" || provider === "google_ai_studio" || provider === "antigravity" || provider === "agy" ?
      [["usageMetadata", value?.usageMetadata], ["response.usageMetadata", value?.response?.usageMetadata]] :
      [["usage", value?.usage]];
  if (provider === "ollama-local" && value?.prompt_eval_count !== undefined) {
    sources.unshift(["prompt_eval_count", { input_tokens: value.prompt_eval_count }]);
  }
  const source = sources.find(([, usage]) => record(usage));
  if (source) {
    const [path, usage] = source;
    accounting.meta.providerUsage = { path, value: usage };
    accounting.tokens = { ...usage };
    for (const [target, names] of Object.entries({
      input_tokens: ["input_tokens", "prompt_tokens", "promptTokenCount"],
      output_tokens: ["output_tokens", "completion_tokens", "candidatesTokenCount"],
      total_tokens: ["total_tokens", "totalTokenCount"],
    })) {
      const name = names.find((key) => usage[key] !== undefined);
      if (name) accounting.tokens[target] = usage[name];
    }
    // These USD fields are the existing usage-ledger contract. OpenRouter's
    // usage.cost mapping is established in utils/usageTracking.js.
    const fields = provider === "openrouter" ? ["cost", "cost_usd", "cost_in_usd", "cost_in_usd_ticks"] :
      ["cost_usd", "cost_in_usd", "cost_in_usd_ticks"];
    for (const field of fields) {
      if (usage[field] === undefined || usage[field] === null) continue;
      accounting.meta.providerCost = { path: `${path}.${field}`, value: usage[field] };
      if (isNumber(usage[field]) && Number.isFinite(usage[field]) && usage[field] >= 0) {
        accounting.cost = field === "cost_in_usd_ticks" ? usage[field] / 1e12 : usage[field];
        accounting.costStatus = "known";
        accounting.costSource = "provider";
      }
      break;
    }
  }
  return accounting;
}

/** Count returned artifacts, not requested images or adapter placeholder rows. */
export function returnedImageUnits(accounting, normalized) {
  if (Array.isArray(normalized?.data)) {
    accounting.nativeUnits.images = normalized.data.filter((item) => item?.b64_json || item?.url).length;
    accounting.meta.nativeUnitsSource = "returned-images";
  }
}

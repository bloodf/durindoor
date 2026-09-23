// Pure model-mapping / thinking-effort resolution for the ChatGPT-web executor.
// Used by the HTTP fallback transport (chatgpt-web-http.js); static maps + pure resolvers.

import { isString } from "../../../src/shared/utils/typeChecks.js";

export const MODEL_MAP = {
  // ChatGPT backend slugs are also accepted directly for power users / tests.
  "gpt-5-6": "gpt-5-6",
  "gpt-5-6-thinking": "gpt-5-6-thinking",
  "gpt-5-6-pro": "gpt-5-6-pro",
  "gpt-5-5": "gpt-5-5",
  "gpt-5-5-thinking": "gpt-5-5-thinking",
  "gpt-5-5-pro": "gpt-5-5-pro",

  // Free accounts leave Luna selection to ChatGPT's server-side auto router.
  "gpt-5.6-luna-free": "auto",
  "gpt-5.6-luna-free-thinking": "auto",

  // Captured from a real ChatGPT v2 picker conversation. The visible
  // performance levels select distinct backend model/effort pairs.
  "gpt-5.6-sol-instant": "gpt-5-6",
  "gpt-5.6-sol-medium": "gpt-5-6-thinking",
  "gpt-5.6-sol-high": "gpt-5-6-thinking",
  "gpt-5.6-sol-xhigh": "gpt-5-6-thinking",
  "gpt-5.6-sol-pro": "gpt-5-6-pro",

  "gpt-5.5-instant": "gpt-5-5",
  "gpt-5.5-medium": "gpt-5-5-thinking",
  "gpt-5.5-high": "gpt-5-5-thinking",
  "gpt-5.5-xhigh": "gpt-5-5-thinking",
  "gpt-5.5-pro": "gpt-5-5-pro",
  "gpt-5.5-pro-extended": "gpt-5-5-pro",
  // Compatibility alias for existing chatgpt-web image integrations. It is
  // intentionally absent from the provider's visible curated model list.
  "gpt-5.5": "gpt-5-5",
};

export const MODEL_FORCED_EFFORT = {
  "gpt-5.6-sol-instant": null,
  "gpt-5.6-sol-medium": "standard",
  "gpt-5.6-sol-high": "extended",
  "gpt-5.6-sol-xhigh": "max",
  "gpt-5.6-sol-pro": "standard",
  "gpt-5.5-instant": null,
  "gpt-5.5-medium": "standard",
  "gpt-5.5-high": "extended",
  "gpt-5.5-xhigh": "max",
  "gpt-5.5-pro": "standard",
  "gpt-5.5-pro-extended": "extended",
};

const MODEL_SYSTEM_HINTS = {
  // Captured from the Free-account Think toggle. ChatGPT sends this both at
  // the request root and on the user message metadata.
  "gpt-5.6-luna-free-thinking": ["reason"],
};

export function resolveChatGptSystemHints(model) {
  return [...(MODEL_SYSTEM_HINTS[model] ?? [])];
}

// Registry ids (shared with the browser transport) that are not ChatGPT
// backend slugs themselves. `gpt-5-5` and `gpt-5-6-sol` are registry aliases
// of the Thinking lanes, matching the browser transport's picker selection.
const REGISTRY_MODEL_ALIASES = {
  "gpt-5-6-instant": "gpt-5-6",
  "gpt-5-6-sol": "gpt-5-6-thinking",
  "gpt-5-5-instant": "gpt-5-5",
  "gpt-5-5": "gpt-5-5-thinking",
};

// OpenAI reasoning_effort to ChatGPT's thinking_effort for the Thinking lanes.
// Only standard/extended/max are observed values, so low effort maps to standard.
const REASONING_TO_THINKING_EFFORT = {
  none: "standard",
  minimal: "standard",
  low: "standard",
  medium: "standard",
  high: "extended",
  xhigh: "max",
  max: "max",
};

function requestedThinkingEffort(slug, body) {
  if (!slug.endsWith("-thinking")) return null;
  const raw = body?.reasoning_effort ?? body?.reasoning?.effort;
  return isString(raw) ? (REASONING_TO_THINKING_EFFORT[raw.toLowerCase()] ?? null) : null;
}

export function resolveChatGptModel(requestedModel, body, _providerSpecificData) {
  const model = REGISTRY_MODEL_ALIASES[requestedModel] ?? requestedModel;
  const slug = MODEL_MAP[model] ?? model;
  const effort = MODEL_FORCED_EFFORT[model] ?? requestedThinkingEffort(slug, body);
  const isPro =
    model === "gpt-5.6-sol-pro" ||
    model === "gpt-5.5-pro" ||
    model === "gpt-5.5-pro-extended" ||
    slug === "gpt-5-6-pro" ||
    slug === "gpt-5-5-pro";
  return { slug, effort, isPro };
}

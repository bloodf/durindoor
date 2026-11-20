// Port of OmniRoute #7891 (eadcbea1c), adapted to DurinDoor JS.
import { isBoolean, isObject } from "../../src/shared/utils/typeChecks.js";
//
// Providers backed by the opencode-go backend (opencode-go, opencode,
// opencode-zen) use a Go ChatCompletionRequest struct where the `reasoning`
// field is typed as `openai.Reasoning` (a structured type, not a bool). When a
// client sends `reasoning: true` or `reasoning: false` — valid per the OpenAI
// API for enabling/disabling reasoning — the Go JSON decoder rejects it with:
//
//   400: json: cannot unmarshal bool into Go struct field
//   ChatCompletionRequest.reasoning of type openai.Reasoning
//
// Strip the boolean `reasoning` before forwarding so the upstream applies its
// own default. Object/string forms match the Go struct and are left untouched.

const OPENCODE_GO_PROVIDERS = new Set(["ollama-cloud", "opencode-go", "opencode", "opencode-zen"]);

/**
 * @param {string} provider
 * @returns {boolean} true when the provider is backed by the opencode-go backend
 */
export function isOpencodeGoProvider(provider) {
  return OPENCODE_GO_PROVIDERS.has(provider);
}

/**
 * Remove a boolean `reasoning` field from the request body in place.
 * Only strips when `reasoning` is a boolean; object/string forms are valid for
 * the Go struct and are forwarded as-is.
 * @param {Record<string, unknown>} body
 * @returns {Record<string, unknown>} the same body (mutated when a bool was removed)
 */
export function stripBooleanReasoning(body) {
  if (!body || !isObject(body)) return body;
  if (isBoolean(body.reasoning)) delete body.reasoning;
  return body;
}

// Only catalogued MiMo routes share the OpenCode gateway's low-to-high contract.
const MIMO_MODELS = {
  "opencode-go": new Set(["mimo-v2.5", "mimo-v2.5-pro"]),
  "opencode-zen": new Set(["mimo-v2.5-free", "mimo-v2.6-flash-free"]),
  opencode: new Set(["mimo-v2.5-free", "mimo-v2.6-flash-free"]),
};

/** Normalize present effort carriers without changing their shape or precedence. */
export function normalizeOpencodeMimoEffort(body, provider, model) {
  if (!body || !MIMO_MODELS[provider]?.has(model)) return body;
  const normalize = (value) => ["xhigh", "max", "ultra"].includes(value) ? "high" : value === "minimal" ? "low" : value;
  if (Object.hasOwn(body, "reasoning_effort")) body.reasoning_effort = normalize(body.reasoning_effort);
  for (const key of ["reasoning", "output_config"]) {
    if (isObject(body[key]) && Object.hasOwn(body[key], "effort")) body[key].effort = normalize(body[key].effort);
  }
  return body;
}

/** Restore explicitly supplied carriers on same-format MiMo requests. */
export function restoreOpencodeMimoEffort(body, original, provider, model) {
  if (!MIMO_MODELS[provider]?.has(model)) return body;
  for (const key of ["reasoning_effort", "reasoning", "output_config"]) {
    if (Object.hasOwn(original, key)) body[key] = original[key];
  }
  return body;
}

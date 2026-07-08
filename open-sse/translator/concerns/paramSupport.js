import { getCapabilitiesForModel } from "../../providers/capabilities.js";

// Strip request params a given provider/model rejects upstream (e.g. HTTP 400).
// Config-driven: add a rule instead of scattering `delete body.x` across executors.

// Each rule: optional provider, regex match on model, list of params to drop.
// A param is removed only when it is present (!== undefined).
const STRIP_RULES = [
  // claude-opus-4 series: temperature is deprecated (Anthropic 400). #1748
  { match: /claude-opus-4/i, drop: ["temperature"] },
  // GitHub Copilot gpt-5.4: temperature unsupported.
  { provider: "github", match: /gpt-5\.4/i, drop: ["temperature"] },
  // GitHub Copilot Claude (except opus/sonnet 4.6): thinking + reasoning_effort rejected. #713
  { provider: "github", match: (m) => /claude/i.test(m) && !/claude.*(opus|sonnet).*4\.6/i.test(m), drop: ["thinking", "reasoning_effort"] },
  // Cloudflare Workers AI: content must be plain string, rejects OpenAI content-part array (#1926)
  { provider: "cloudflare-ai", flattenContent: true },
  // Mistral: rejects reasoning_content carried in assistant message history with
  // 422 extra_forbidden. Reasoning models (DeepSeek R1, mimo, o-series, etc.) emit
  // this field on assistant turns; it is only meaningful in streamed responses, not
  // in request bodies. Strip it from every message before forwarding. #1649
  { provider: "mistral", dropMessageFields: ["reasoning_content"] },
  // NVIDIA NIM z-ai/glm-5.2 rejects both OpenAI-style `reasoning` and
  // Claude-style `thinking` request fields on its OpenAI-compatible wrapper.
  { provider: "nvidia", match: /z-ai\/glm-5\.2\b/i, drop: ["reasoning", "thinking"] },
  { provider: "volcengine-ark", match: /glm-5/i, clampToModelMaxOutput: true },
];

// Test a rule's match (regex or predicate) against the model id.
// A rule with no match clause applies to every model for its provider.
function matches(rule, model) {
  if (!rule.match) return true;
  return typeof rule.match === "function" ? rule.match(model) : rule.match.test(model);
}

function clampNumber(body, key, ceiling) {
  if (typeof body[key] === "number" && Number.isFinite(body[key]) && body[key] > ceiling) {
    body[key] = ceiling;
  }
}

// Remove unsupported params from body in place; returns body.
export function stripUnsupportedParams(provider, model, body) {
  if (!model || !body || typeof body !== "object") return body;
  for (const rule of STRIP_RULES) {
    if (rule.provider && rule.provider !== provider) continue;
    if (!matches(rule, model)) continue;
    // Drop top-level params (guard: a rule may omit `drop`, e.g. message-only rules).
    for (const key of rule.drop || []) {
      if (body[key] !== undefined) delete body[key];
    }
    // Drop per-message fields some providers reject in history, e.g. Mistral rejects
    // assistant reasoning_content with 422 extra_forbidden (#1649).
    if (Array.isArray(rule.dropMessageFields) && Array.isArray(body.messages)) {
      for (const msg of body.messages) {
        if (!msg || typeof msg !== "object") continue;
        for (const field of rule.dropMessageFields) {
          if (msg[field] !== undefined) delete msg[field];
        }
      }
    }
    // CF Workers AI oneOf root schema only accepts content as plain string (#1926)
    if (rule.flattenContent && Array.isArray(body.messages)) {
      for (const msg of body.messages) {
        if (msg && Array.isArray(msg.content)) {
          msg.content = msg.content
            .map(b => (b?.type === "text" && typeof b.text === "string") ? b.text : "")
            .join("");
        }
      }
    }
    if (rule.clampToModelMaxOutput || Number.isFinite(rule.maxOutputCap)) {
      const modelCeiling = getCapabilitiesForModel(provider, model).maxOutput;
      const candidates = [];
      if (rule.clampToModelMaxOutput && Number.isFinite(modelCeiling) && modelCeiling > 0) {
        candidates.push(modelCeiling);
      }
      if (Number.isFinite(rule.maxOutputCap) && rule.maxOutputCap > 0) {
        candidates.push(rule.maxOutputCap);
      }
      if (candidates.length > 0) {
        const ceiling = Math.min(...candidates);
        clampNumber(body, "max_tokens", ceiling);
        clampNumber(body, "max_completion_tokens", ceiling);
        clampNumber(body, "max_output_tokens", ceiling);
      }
    }
  }
  return body;
}

// Model-specific param renames (max_tokens → max_completion_tokens for newer OpenAI models)
const MODEL_PARAM_RENAMES = {
  "openai": [
    { match: /gpt-5|o[134]-/, rename: { max_tokens: "max_completion_tokens" } },
  ],
};

/**
 * Apply model-specific param renames (e.g. max_tokens → max_completion_tokens for gpt-5+).
 * @param {string} provider
 * @param {string} model
 * @param {object} body
 */
export function applyParamRenames(provider, model, body) {
  const rules = MODEL_PARAM_RENAMES[provider] || [];
  for (const rule of rules) {
    if (rule.match.test(model)) {
      for (const [from, to] of Object.entries(rule.rename)) {
        if (body[from] !== undefined && body[to] === undefined) {
          body[to] = body[from];
          delete body[from];
        }
      }
    }
  }
}

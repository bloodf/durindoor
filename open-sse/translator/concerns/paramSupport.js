import { getCapabilitiesForModel } from "../../providers/capabilities.js";

// Strip request params a given provider/model rejects upstream (e.g. HTTP 400).
// Config-driven: add a rule instead of scattering `delete body.x` across executors.

// Each rule: optional provider, regex match on model, list of params to drop.
// A param is removed only when it is present (!== undefined).
const STRIP_RULES = [
  /** All Claude models reject the deprecated temperature parameter upstream with HTTP 400. */
  { match: /claude/i, drop: ["temperature"] },
  // GitHub Copilot gpt-5.4: temperature unsupported.
  { provider: "github", match: /gpt-5\.4/i, drop: ["temperature"] },
  // GitHub Copilot Claude (except opus/sonnet 4.6): thinking + reasoning_effort rejected. #713
  { provider: "github", match: (m) => /claude/i.test(m) && !/claude.*(opus|sonnet).*4\.6/i.test(m), drop: ["thinking", "reasoning_effort"] },
  // xAI Grok Composer: rejects reasoningEffort entirely (including "none") — omit param upstream.
  // Upstream: decolua/9router#2534.
  { provider: "xai", match: /grok-composer/i, drop: ["thinking", "reasoning_effort", "reasoning"] },
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
    // CF Workers AI oneOf root schema only accepts content as plain string (#1926).
    // #6390: the endpoint has no way to carry image/non-text parts once flattened,
    // so previously any non-text part (e.g. image_url) was silently mapped to "" and
    // the attachment vanished from the outgoing request with no error. Refuse instead
    // of silently dropping data — a plain Error here surfaces through chatCore's
    // executor error path (sanitizeErrorMessage) before reaching the client.
    if (rule.flattenContent && Array.isArray(body.messages)) {
      for (const msg of body.messages) {
        if (msg && Array.isArray(msg.content)) {
          msg.content = msg.content
            .map(b => {
              if (b?.type === "text" && typeof b.text === "string") return b.text;
              const got = typeof b?.type === "string" ? b.type : "unknown";
              throw new Error(
                "Cloudflare Workers AI chat endpoint does not accept image/non-text content parts " +
                `(got type "${got}"). Remove image/file attachments or route this request to a vision-capable provider.`
              );
            })
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

// Model families that reject legacy `max_tokens` and only accept
// `max_completion_tokens`. DurinDoor keeps its dev-parity reasoning-model set
// (o1/o3/o4 + the whole gpt-5.x family, matching the pre-port GitHub rule
// `/gpt-5|o[134]-/i`) rather than the source's narrower exact list — so o4-mini
// and gpt-5.6 keep the forward rename they had before this port.
// Direction is decided by the MODEL STRING ALONE, provider-independent, mirroring
// OmniRoute's supportsMaxTokens (modelCapabilities.ts). Source matches by raw
// substring; DurinDoor anchors at a prefix boundary (`^`, `/`, `:`) and a version
// boundary (`.`, `-`, end) so `openai/o3-mini`, `azure:o1`, `gpt-5.4-pro`, and
// `gpt-5.40` (a gpt-5.x version) match while `o3mini`, `deepseek-v3o1`, `o2` do not.
const MAX_TOKENS_UNSUPPORTED_MODEL = /(?:^|[/:])(?:o[134]|gpt-5(?:\.\d+)?)(?:[.-]|$)/i;

/**
 * Normalize the max-token field name for the target model, in place.
 * - Family match (o1-family/o3-family/o4-family/gpt-5[.x]): forward rename `max_tokens` → `max_completion_tokens`.
 * - Any other model: reverse rename `max_completion_tokens` → `max_tokens`, because
 *   legacy-compatible providers (Volcengine Ark / DeepSeek, …) silently ignore the
 *   newer field and would apply no cap (OmniRoute #6912/#6964).
 * Precedence both directions: an explicitly set destination field always wins;
 * the source field is still deleted so only one spelling reaches upstream.
 * @param {string} provider
 * @param {string} model
 * @param {object} body
 */
export function applyParamRenames(provider, model, body) {
  void provider; // direction is model-driven only (OmniRoute supportsMaxTokens parity)
  if (MAX_TOKENS_UNSUPPORTED_MODEL.test(model)) {
    if (body.max_tokens !== undefined) {
      if (body.max_completion_tokens === undefined) body.max_completion_tokens = body.max_tokens;
      delete body.max_tokens;
    }
    return;
  }

  if (body.max_completion_tokens !== undefined) {
    if (body.max_tokens === undefined) body.max_tokens = body.max_completion_tokens;
    delete body.max_completion_tokens;
  }
}

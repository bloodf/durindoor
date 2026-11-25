import { getCapabilitiesForModel } from "../../providers/capabilities.js";
import { isOpenCodeZenBaseUrl } from "../../providers/shared.js";
import { ROLE } from "../schema/roles.js";

// Strip request params a given provider/model rejects upstream (e.g. HTTP 400).
// Config-driven: add a rule instead of scattering `delete body.x` across executors.

// Each rule: optional provider string/regex, regex match on model, list of params to drop.
// A param is removed only when it is present (!== undefined).
import { isBoolean, isFunction, isNumber, isObject, isString } from "../../../src/shared/utils/typeChecks.js";

/**
 * Legacy OpenAI reasoning models that reject the standard sampling controls.
 *
 * OmniRoute #412 (head d79b55be5a, merge d261ae7883) declared an
 * `unsupportedParams` list on the OpenAI registry rows `o1`, `o1-mini`,
 * `o1-pro`, `o3` and `o3-mini`, and deleted the listed parameters from the
 * translated body before the executor call. The upstream rows are the
 * version-specific contract; this set is that list intersected with the live
 * local OpenAI catalog:
 *
 * - `o1` and `o1-2024-12-17` (the documented snapshot of `o1`);
 * - `o1-pro` and `o1-pro-2025-03-19` (the documented snapshot of `o1-pro`);
 * - `o3`.
 *
 * `o1-mini` and `o3-mini` are deliberately absent: OpenAI shut them down on
 * 2025-10-27 and 2026-10-23 and the local registry rows were retired (see
 * internal/docs/port-reports/1072-retired-model-catalog-5781.md), so they are
 * neither supported exact ids nor documented aliases here. `o3-pro` is a live
 * local row that the upstream list does not contain, so extending the rule to
 * it would generalize beyond the pinned contract. Neither o4, gpt-5.x nor
 * gpt-6.x is in scope: those models accept sampling controls.
 */
const LEGACY_OPENAI_REASONING_MODELS = new Set([
  "o1",
  "o1-2024-12-17",
  "o1-pro",
  "o1-pro-2025-03-19",
  "o3",
]);

/**
 * Resolve the bare model id for a rule match.
 *
 * Upstream #412 also matched a provider-prefixed id (`openai/o3` → `o3`) and
 * a cross-provider lookup. DurinDoor strips the provider prefix during
 * routing, so the outbound path always carries the bare id; the prefixed form
 * is only tolerated here. The lookup stays scoped to one provider: upstream's
 * cross-provider map would also strip sampling fields on a third-party
 * provider that merely serves a model named `o3`, which is not the upstream
 * contract this port covers.
 */
function bareModelId(model) {
  const id = isString(model) ? model.trim() : String(model ?? "").trim();
  if (!id.includes("/")) return id;
  return id.split("/").pop() || "";
}

const STRIP_RULES = [
// 9router 7c42d8f: OpenAI accepts the modern completion cap. Keep explicit
// destination values and scope this policy to the actual OpenAI provider.
{ provider: "openai", renameParams: { max_tokens: "max_completion_tokens" } },
/**
 * Claude models reject deprecated temperature and Claude Code's top-level
 * telemetry with `diagnostics: Extra inputs are not permitted`.
 */
{ match: /claude/i, drop: ["temperature", "diagnostics"] },
/**
 * OpenCode Go's Claude lane (/messages) rejects output_config.task_budget even with its own
 * beta flag (400 "Extra inputs are not permitted"). effort stays: adaptive thinking needs it.
 * context_management is supported there once its beta flag travels (see default.js).
 */
{ provider: "opencode-go", match: /claude/i, dropOutputConfigFields: ["task_budget"] },
/** Claude Opus 5.5 also rejects the remaining sampling controls. */
{ match: /claude-opus-5[-.]5/i, drop: ["top_p", "top_k"] },
// GitHub Copilot GPT-5.4+ (within 5.x) and GPT-6.x: temperature unsupported.
{ provider: "github", match: /^gpt-(?:5\.(?:[4-9]|[1-9]\d+)|6(?:\.\d+)?)(?:-|$)/i, drop: ["temperature"] },
// OpenAI GPT-6 Astra supports neither sampling nor top-logprob controls.
// Chat rejects `logprobs`; Responses rejects only its output-text include entry.
{ provider: "openai", match: /^gpt-6-astra$/i, drop: ["temperature", "top_p", "top_logprobs"], dropChat: ["logprobs"], dropInclude: ["message.output_text.logprobs"] },
// OmniRoute #412: the legacy OpenAI reasoning models reject the standard
// sampling controls with a 400. Upstream deleted them from the translated
// body before the executor call; this table is the equivalent insertion point
// and runs on the outbound path of both the Chat-to-Responses route and the
// native Responses route. Reasoning, tool and token-limit fields are not
// listed and stay untouched.
{
  provider: "openai",
  match: (model) => LEGACY_OPENAI_REASONING_MODELS.has(bareModelId(model)),
  drop: ["temperature", "top_p", "frequency_penalty", "presence_penalty", "logprobs", "top_logprobs", "n"],
},
// GitHub Copilot Claude (except opus/sonnet 4.6): thinking + reasoning_effort rejected. #713
{ provider: "github", match: (m) => /claude/i.test(m) && !/claude.*(opus|sonnet).*4\.6/i.test(m), drop: ["thinking", "reasoning_effort"] },
// xAI Grok Composer: rejects reasoningEffort entirely (including "none") — omit param upstream.
// Upstream: decolua/9router#2534.
{ provider: "xai", match: /grok-composer/i, drop: ["thinking", "reasoning_effort", "reasoning"] },
/** OpenCode Muse Responses rejects every Chat and Responses token-cap spelling. */
{ provider: "opencode", match: /muse/i, drop: ["max_tokens", "max_completion_tokens", "max_output_tokens"] },
// Cloudflare Workers AI: content must be plain string, rejects OpenAI content-part array (#1926)
{ provider: "cloudflare-ai", flattenContent: true },
// Strict OpenAI-compatible validators reject unknown assistant-message fields.
// Clients that talk to reasoning models (Hermes Agent, and anything following
// the DeepSeek/Kimi convention) echo the previous turn's reasoning back on every
// assistant message; Groq answers 400, Mistral 422 extra_forbidden, Cerebras 400
// wrong_api_format. Reasoning models emit these fields on assistant turns; they
// are only meaningful in streamed responses, not in request bodies. Providers
// that *require* the field (DeepSeek, Kimi) are not listed here. #1649 #4220
{ provider: "groq", dropMessageFields: ["reasoning_content", "reasoning", "reasoning_details"] },
{ provider: "mistral", dropMessageFields: ["reasoning_content", "reasoning", "reasoning_details"] },
{ provider: "cerebras", dropMessageFields: ["reasoning_content", "reasoning", "reasoning_details"] },
// OpenCode Go's relay rejects `response_format` (json_schema and json_object)
// for its deepseek family with HTTP 400 and a body that names neither the field
// nor the reason, while other models on the same relay accept it. Measured
// upstream 2026-10-13: 12/12 structured calls 400, 4/4 without the field 200
// (decolua/9router 468aa7d9).
{ provider: "opencode-go", match: /^deepseek/i, drop: ["response_format"] },
// OpenCode Go GPT Responses rejects temperature.
{ provider: "opencode-go", match: /^gpt-/i, drop: ["temperature"] },

// 9router ced0cf6: NIM treats these as aliases and rejects duplicate fields.
// decolua/9router#5070: its Chat wrapper also rejects the Responses `text` object.
{
  provider: "nvidia",
  drop: ["client_metadata", "prompt_cache_key", "service_tier", "anthropic_beta", "thinking_budget", "user_id", "custom_field", "text"],
  renameMessageFields: { reasoning: "reasoning_content" }
},
// Mistral's OpenAI-compatible API validates the body strictly and rejects the
// Anthropic/Z.ai-native `thinking` object with 422 extra_forbidden. It only
// accepts `reasoning_effort`, so drop any stray native thinking field that
// survives translation (final wire guard alongside registry thinkingFormat).
{ provider: "mistral", drop: ["thinking"] },
// NVIDIA NIM z-ai/glm-5.2 rejects both OpenAI-style `reasoning` and
// Claude-style `thinking` request fields on its OpenAI-compatible wrapper.
{ provider: "nvidia", match: /z-ai\/glm-5\.2\b/i, drop: ["reasoning", "thinking"] },
{ provider: "volcengine-ark", match: /glm-5/i, clampToModelMaxOutput: true }];

// Test a rule's match (regex or predicate) against the model id.
// A rule with no match clause applies to every model for its provider.
function matches(rule, model) {
  if (!rule.match) return true;
  return isFunction(rule.match) ? rule.match(model) : rule.match.test(model);
}

/**
 * Match an exact string or RegExp provider selector (`decolua/9router#3186`).
 * DurinDoor deliberately ports only matcher plumbing: fork #2800 forces
 * `reasoning_effort` for `openai-compatible-*`, so no upstream stripping policy applies.
 */
function matchesProvider(selector, provider) {
  return selector instanceof RegExp ? selector.test(provider) : selector === provider;
}

function clampNumber(body, key, ceiling) {
  if (isNumber(body[key]) && Number.isFinite(body[key]) && body[key] > ceiling) {
    body[key] = ceiling;
  }
}

// Final OpenAI-compatible wire guard for extension fields rejected by strict
// transports. The selected runtime transport wins; provider config supplies the
// default when its selected transport omits quirks. Missing or malformed config
// fails closed. Mutates and returns the same body.
export function stripUnsupportedChatExtensions(body, transport, defaultTransport = null) {
  if (!body || !isObject(body)) return body;
  let quirks;
  try {
    quirks = transport?.quirks ?? defaultTransport?.quirks;
  } catch {
    quirks = null;
  }
  if (!quirks?.preservePromptCacheKey && body.prompt_cache_key !== undefined) {
    delete body.prompt_cache_key;
  }
  return body;
}

/**
 * Remove unsupported request parameters in place.
 * `rules` is injectable without exposing mutable global state so
 * `decolua/9router#3186` RegExp selector integration stays load-bearing in tests.
 * DurinDoor adds no compatible-provider reasoning rule because fork #2800 forces
 * `reasoning_effort` for `openai-compatible-*`.
 *
 * A custom OpenAI-compatible Muse request strips token caps only when its
 * configured base URL exactly identifies OpenCode Zen. Luna remains unchanged:
 * its Responses endpoint has no independently verified fork contract.
 */
export function stripUnsupportedParams(provider, model, body, caps = null, rules = STRIP_RULES, credentials = null) {
  if (!model || !body || !isObject(body)) return body;
  // Mistral Chat validates a closed schema; Responses requests use a different schema.
  if (provider === "mistral" && Array.isArray(body.messages)) {
    for (const [from, to] of [["seed", "random_seed"], ["max_completion_tokens", "max_tokens"]]) {
      if (body[to] === undefined && body[from] != null) body[to] = body[from];
      delete body[from];
    }
    for (const field of ["user", "logit_bias", "store", "verbosity"]) delete body[field];
    if (isNumber(body.temperature) && body.temperature > 1.5) body.temperature = 1.5;
    if (Object.hasOwn(body, "service_tier")) {
      if (["default", "flex", "scale"].includes(body.service_tier)) body.service_tier = "standard_only";
      else if (!["auto", "standard_only"].includes(body.service_tier)) delete body.service_tier;
    }
  }
  // LLMTR rejects Responses-style reasoning objects on its Chat endpoint.
  if (provider === "llmtr" && body.reasoning != null && !isBoolean(body.reasoning)) {
    const value = body.reasoning;
    body.reasoning = !(value?.enabled === false || value?.effort === "none" || value?.effort === "off");
  }

  if (
  provider?.startsWith?.("openai-compatible-") &&
  /muse/i.test(model) &&
  isOpenCodeZenBaseUrl(credentials?.providerSpecificData?.baseUrl))
  {
    for (const key of ["max_tokens", "max_completion_tokens", "max_output_tokens"]) delete body[key];
  }
  for (const rule of rules) {
    if (rule.provider && !matchesProvider(rule.provider, provider)) continue;
    if (!matches(rule, model)) continue;
    // Rename before clamps; a client-supplied target wins even when it is zero.
    for (const [from, to] of Object.entries(rule.renameParams || {})) {
      if (body[from] === undefined) continue;
      if (body[to] === undefined) body[to] = body[from];
      delete body[from];
    }
    // Drop top-level params (guard: a rule may omit `drop`, e.g. message-only rules).
    for (const key of rule.drop || []) {
      if (body[key] !== undefined) delete body[key];
    }
    // Nested drops: keep the rest of output_config, remove it only when left empty.
    for (const key of rule.dropOutputConfigFields || []) {
      if (isObject(body.output_config) && body.output_config[key] !== undefined) {
        delete body.output_config[key];
        if (Object.keys(body.output_config).length === 0) delete body.output_config;
      }
    }
    if (Array.isArray(rule.dropChat) && Array.isArray(body.messages)) {
      for (const key of rule.dropChat) {
        if (body[key] !== undefined) delete body[key];
      }
    }
    if (Array.isArray(rule.dropInclude) && Array.isArray(body.include)) {
      body.include = body.include.filter((entry) => !rule.dropInclude.includes(entry));
      if (body.include.length === 0) delete body.include;
    }
    // Drop per-message fields some providers reject in history, e.g. Mistral rejects
    // assistant reasoning_content with 422 extra_forbidden (#1649). Assistant turns
    // only: that is where clients replay reasoning; a user-authored field is left
    // alone (#4220).
    if ((rule.renameMessageFields || Array.isArray(rule.dropMessageFields)) && Array.isArray(body.messages)) {
      for (const msg of body.messages) {
        if (!msg || !isObject(msg) || msg.role !== ROLE.ASSISTANT) continue;
        for (const [from, to] of Object.entries(rule.renameMessageFields || {})) {
          if (msg[from] === undefined) continue;
          const existing = msg[to];
          if (existing === undefined || existing === null || isString(existing) && !existing.trim()) {
            msg[to] = msg[from];
          }
          delete msg[from];
        }
        for (const field of Array.isArray(rule.dropMessageFields) ? rule.dropMessageFields : []) {
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
    // Port of upstream #5811: the chat transport is the OpenAI-compatible
    // /ai/v1/chat/completions endpoint, which accepts content-part arrays (image_url
    // included) natively. Flattening deleted images for every vision-capable model,
    // so content parts pass through unchanged when the model resolves vision: true.
    // Non-vision models keep the flatten-or-refuse contract above.
    if (rule.flattenContent && Array.isArray(body.messages) &&
        !(caps || getCapabilitiesForModel(provider, model)).vision) {
      for (const msg of body.messages) {
        if (msg && Array.isArray(msg.content)) {
          msg.content = msg.content.
          map((b) => {
            if (b?.type === "text" && isString(b.text)) return b.text;
            const got = isString(b?.type) ? b.type : "unknown";
            throw new Error(
              "Cloudflare Workers AI chat endpoint does not accept image/non-text content parts " +
              `(got type "${got}"). Remove image/file attachments or route this request to a vision-capable provider.`
            );
          }).
          join("");
        }
      }
    }
    if (rule.clampToModelMaxOutput || Number.isFinite(rule.maxOutputCap)) {
      const modelCeiling = (caps || getCapabilitiesForModel(provider, model)).maxOutput;
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
// For non-OpenAI providers, direction is model-driven, mirroring
// OmniRoute's supportsMaxTokens (modelCapabilities.ts). Source matches by raw
// substring; DurinDoor anchors at a prefix boundary (`^`, `/`, `:`, `-`) and a
// version boundary (`.`, `-`, end) so `openai/o3-mini`, `azure:o1`, `databricks-gpt-5`,
// and `gpt-5.40` match while `o3mini`, `deepseek-v3o1`, `databricks-gpt-50`, and
// `databricks-agpt-5` do not.
const MAX_TOKENS_UNSUPPORTED_MODEL = /(?:^|[/:-])(?:o[134]|gpt-5(?:\.\d+)?)(?:[.-]|$)/i;
// Copilot also requires the modern spelling for GPT-6 and later (upstream decolua/9router#4621).
const GITHUB_MAX_TOKENS_UNSUPPORTED_MODEL = /^gpt-[6-9](?:[.-]|$)/i;

/**
 * Normalize the max-token field name for the target model, in place.
 * - OpenAI provider or family match (o1/o3/o4/gpt-5[.x]): forward rename
 *   `max_tokens` → `max_completion_tokens`.
 * - Other providers and models: reverse rename `max_completion_tokens` → `max_tokens`, because
 *   legacy-compatible providers (Volcengine Ark / DeepSeek, …) silently ignore the
 *   newer field and would apply no cap (OmniRoute #6912/#6964).
 * Precedence both directions: an explicitly set destination field always wins;
 * the source field is still deleted so only one spelling reaches upstream.
 * @param {string} provider
 * @param {string} model
 * @param {object} body
 */
export function applyParamRenames(provider, model, body) {
  // This runs before stripUnsupportedParams at the executor boundary. Select
  // OpenAI's forward policy here too, or reverse renaming GPT-6 would erase an
  // explicitly supplied max_completion_tokens before the final wire rule (#1366).
  if (provider === "openai" || MAX_TOKENS_UNSUPPORTED_MODEL.test(model) ||
    provider === "github" && GITHUB_MAX_TOKENS_UNSUPPORTED_MODEL.test(model)) {
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

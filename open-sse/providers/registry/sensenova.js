// SenseNova Token Plan ceiling: the /v1/chat/completions endpoint rejects
import { isNumber, isObject, isString } from "../../../src/shared/utils/typeChecks.js";
// max_tokens / max_completion_tokens above 65536. requestDefaults.maxTokens only
// fills the field when BOTH are absent, so an explicit client value above the
// ceiling must be clamped here before the body is forwarded upstream.
const SENSENOVA_MAX_OUTPUT_TOKENS = 65536;

function clampSensenovaMaxTokens(body) {
  if (!body || !isObject(body)) return body;
  if (isNumber(body.max_tokens) && body.max_tokens > SENSENOVA_MAX_OUTPUT_TOKENS) {
    body.max_tokens = SENSENOVA_MAX_OUTPUT_TOKENS;
  }
  if (isNumber(body.max_completion_tokens) && body.max_completion_tokens > SENSENOVA_MAX_OUTPUT_TOKENS) {
    body.max_completion_tokens = SENSENOVA_MAX_OUTPUT_TOKENS;
  }
  return body;
}

// SenseNova streams thinking deltas under choices[].delta.reasoning (not the
// OpenAI-compatible reasoning_content the passthrough filter recognises). Map
// reasoning -> reasoning_content in-place so the chunk survives the
// hasValuableContent gate and reaches the client on the same-format path.
function normalizeSensenovaStreamChunk(parsed) {
  const choices = parsed?.choices;
  if (!Array.isArray(choices)) return false;
  let changed = false;
  for (const choice of choices) {
    const delta = choice?.delta;
    if (!delta || !isObject(delta)) continue;
    if (isString(delta.reasoning) && delta.reasoning && !delta.reasoning_content) {
      delta.reasoning_content = delta.reasoning;
      changed = true;
    }
  }
  return changed;
}

// Non-stream counterpart: SenseNova returns thinking as choices[].message.reasoning
// on stream:false responses, but Claude/Responses conversion and request-detail
// logging read message.reasoning_content. Map it in-place so non-stream
// completions don't silently drop reasoning.
function normalizeSensenovaResponse(parsed) {
  const choices = parsed?.choices;
  if (!Array.isArray(choices)) return false;
  let changed = false;
  for (const choice of choices) {
    const message = choice?.message;
    if (!message || !isObject(message)) continue;
    if (isString(message.reasoning) && message.reasoning && !message.reasoning_content) {
      message.reasoning_content = message.reasoning;
      changed = true;
    }
  }
  return changed;
}

export default {
  id: "sensenova",
  alias: "sensenova",
  display: {
    name: "SenseNova",
    icon: "auto_awesome",
    iconUrl: "/providers/sensenova.svg",
    color: "#0066FF",
    textIcon: "SN",
    website: "https://platform.sensenova.cn",
    notice: {
      text: "SenseNova registration appears to require a Chinese (+86) phone number for SMS verification; international users may be unable to obtain an API key.",
      signupUrl: "https://platform.sensenova.cn/console"
    }
  },
  category: "freeTier",
  transport: {
    // SenseNova Token Plan (validated 2026-07-06): OpenAI-compatible endpoint
    // that enforces max_tokens in [1, 65536]. We only CLAMP explicit over-ceiling
    // values — we do NOT inject a default when both token fields are omitted, so
    // omitted-token requests keep the Token Plan's own default budget instead of
    // always asking for the 65536 maximum.
    baseUrl: "https://token.sensenova.cn/v1/chat/completions",
    clampRequestBody: clampSensenovaMaxTokens,
    normalizeStreamChunk: normalizeSensenovaStreamChunk,
    normalizeResponse: normalizeSensenovaResponse
  },
  models: [
  // SenseNova Token Plan chat models (validated 2026-07-06). The /models
  // list also advertises sensenova-u1-fast, but chat completions 404 for it;
  // U1 Fast belongs to image flows, so omit it here.
  {
    id: "sensenova-6.7-flash-lite",
    name: "SenseNova 6.7 Flash-Lite",
    contextLength: 262144,
    maxOutputTokens: 65536,
    supportsVision: true,
    toolCalling: true
  },
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    contextLength: 1048576,
    maxOutputTokens: 65536,
    supportsReasoning: true,
    interleavedField: "reasoning_content"
  },
  {
    id: "glm-5.2",
    name: "GLM 5.2",
    contextLength: 1048576,
    maxOutputTokens: 65536,
    supportsReasoning: true,
    interleavedField: "reasoning_content"
  }],

  passthroughModels: true
};
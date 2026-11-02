// open-sse/services/compression/engines/lite.js
//
// Lite compression engine: whitespace/format cleanup plus opt-in bounded
// tool-result truncation.
//
// Ported from OmniRoute open-sse/services/compression/lite.ts
// (diegosouzapw/OmniRoute@61e07fb7, MIT; PRs #1633 and #13915). Deviations,
// all conservative:
//   - Whitespace cleanup skips fenced code blocks, system/developer messages
//     (unless preserveSystemPrompt === false), and every tool output.
//   - System-prompt dedup compares full content (upstream compared the first
//     200 characters, which could drop a different prompt).
//   - Tool-result truncation is OFF unless the step sets
//     truncateToolResults: true (upstream default on). It never touches error
//     results, current-turn results, JSON or fenced-code payloads.
//   - Image-to-placeholder replacement is not ported: media is a protected block.
// Never mutates the caller body. Responses/Kiro bodies go through bodyAdapter.

import { adaptBodyForCompression } from "../bodyAdapter.js";
import { createCompressionStats } from "../stats.js";
import { isBoolean, isNumber, isObject, isString } from "../../../../src/shared/utils/typeChecks.js";

const DEFAULT_MAX_TOOL_LENGTH = 2000;
const MIN_MAX_TOOL_LENGTH = 256;
const MAX_MAX_TOOL_LENGTH = 1_000_000;
const TOOL_TRUNCATION_LOOKBACK = 80;
const TRUNCATION_MARKER = "\n...[truncated]";
const FENCE_RE = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/;
const INSTRUCTION_ROLES = new Set(["system", "developer"]);

export function resolveLiteMaxToolLength(value) {
  if (!isNumber(value) || !Number.isFinite(value)) return DEFAULT_MAX_TOOL_LENGTH;
  const n = Math.floor(value);
  return n >= MIN_MAX_TOOL_LENGTH && n <= MAX_MAX_TOOL_LENGTH ? n : DEFAULT_MAX_TOOL_LENGTH;
}

/** Collapse 3+ newlines and strip trailing spaces, outside fenced code only. */
export function normalizeProseWhitespace(text) {
  if (!text) return text;
  return text.
  split(FENCE_RE).
  map((segment, i) => i % 2 === 1 ? segment : segment.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+$/gm, "")).
  join("");
}

function isTextPart(part) {
  return isObject(part) && isString(part.text) && (part.type === "text" || part.type === "input_text");
}

function cleanMessage(msg) {
  if (isString(msg.content)) {
    const next = normalizeProseWhitespace(msg.content);
    return next === msg.content ? msg : { ...msg, content: next };
  }
  if (!Array.isArray(msg.content)) return msg;
  let changed = false;
  const content = msg.content.map((part) => {
    if (!isTextPart(part)) return part; // tool_result, images, documents untouched
    const next = normalizeProseWhitespace(part.text);
    if (next === part.text) return part;
    changed = true;
    return { ...part, text: next };
  });
  return changed ? { ...msg, content } : msg;
}

function collapseWhitespace(messages, preserveSystem) {
  let applied = false;
  const out = messages.map((msg) => {
    if (!isObject(msg) || msg.role === "tool") return msg;
    if (preserveSystem && INSTRUCTION_ROLES.has(msg.role)) return msg;
    const next = cleanMessage(msg);
    if (next !== msg) applied = true;
    return next;
  });
  return { messages: out, applied };
}

function dedupSystemPrompt(messages) {
  const seen = new Set();
  let applied = false;
  const out = messages.filter((msg) => {
    if (msg?.role !== "system" || !isString(msg.content)) return true;
    if (seen.has(msg.content)) {
      applied = true;
      return false;
    }
    seen.add(msg.content);
    return true;
  });
  return { messages: out, applied };
}

function removeRedundantContent(messages, preserveSystem) {
  let applied = false;
  const out = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const prev = messages[i - 1];
    const duplicate =
    i > 0 &&
    msg?.role !== "tool" &&
    !(preserveSystem && INSTRUCTION_ROLES.has(msg?.role)) &&
    !msg?.tool_calls &&
    !prev?.tool_calls &&
    prev?.role === msg?.role &&
    isString(msg?.content) &&
    msg.content.length > 0 &&
    prev.content === msg.content;
    if (duplicate) {
      applied = true;
      continue;
    }
    out.push(msg);
  }
  return { messages: out, applied };
}

function backOffToWordBoundary(content, cutIndex) {
  const isWord = (c) => c !== undefined && /\S/.test(c);
  if (!isWord(content[cutIndex - 1]) || !isWord(content[cutIndex])) return cutIndex;
  for (let i = cutIndex; i > Math.max(0, cutIndex - TOOL_TRUNCATION_LOOKBACK); i--) {
    if (!isWord(content[i - 1])) return i - 1;
  }
  for (let i = cutIndex; i < Math.min(content.length, cutIndex + TOOL_TRUNCATION_LOOKBACK); i++) {
    if (!isWord(content[i])) return i;
  }
  return cutIndex;
}

function isStructuredPayload(text) {
  const t = text.trimStart();
  return t.startsWith("{") || t.startsWith("[") || /```|~~~/.test(text);
}

function truncateToolResults(messages, maxLength) {
  // Results after the last assistant turn are what the model asked for now;
  // cutting them makes it re-read the same file forever.
  let lastAssistant = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "assistant") {
      lastAssistant = i;
      break;
    }
  }
  const currentTurnStart = lastAssistant === -1 ? messages.length : lastAssistant + 1;
  let applied = false;
  const out = messages.map((msg, index) => {
    if (index >= currentTurnStart) return msg;
    if (msg?.role !== "tool" || msg.is_error === true || !isString(msg.content)) return msg;
    if (msg.content.length <= maxLength || isStructuredPayload(msg.content)) return msg;
    applied = true;
    const cut = backOffToWordBoundary(msg.content, maxLength);
    return { ...msg, content: msg.content.slice(0, cut) + TRUNCATION_MARKER };
  });
  return { messages: out, applied };
}

/**
 * @param {object} body
 * @param {{preserveSystemPrompt?: boolean, truncateToolResults?: boolean, maxToolLength?: number}} [options]
 */
export function applyLiteCompression(body, options = {}) {
  if (!Array.isArray(body?.messages)) return { body, compressed: false, stats: null };
  const preserveSystem = options.preserveSystemPrompt !== false;
  const techniques = [];
  let messages = body.messages;

  const steps = [
  ["whitespace", (m) => collapseWhitespace(m, preserveSystem)],
  ["system-dedup", (m) => preserveSystem ? { messages: m, applied: false } : dedupSystemPrompt(m)],
  ["tool-truncate", (m) =>
  options.truncateToolResults === true ?
  truncateToolResults(m, resolveLiteMaxToolLength(options.maxToolLength)) :
  { messages: m, applied: false }],
  ["redundant-remove", (m) => removeRedundantContent(m, preserveSystem)]];

  for (const [name, step] of steps) {
    const r = step(messages);
    messages = r.messages;
    if (r.applied) techniques.push(name);
  }

  if (techniques.length === 0) return { body, compressed: false, stats: null };
  const next = { ...body, messages };
  return { body: next, compressed: true, stats: createCompressionStats(body, next, "lite", techniques) };
}

const LITE_SCHEMA = [
{ key: "truncateToolResults", type: "boolean", label: "Truncate older tool results", defaultValue: false },
{
  key: "maxToolLength",
  type: "number",
  label: "Tool result max length",
  defaultValue: DEFAULT_MAX_TOOL_LENGTH,
  min: MIN_MAX_TOOL_LENGTH,
  max: MAX_MAX_TOOL_LENGTH
}];


export const liteEngine = {
  id: "lite",
  name: "Lite",
  description: "Whitespace/format cleanup with opt-in bounded tool-result truncation.",
  icon: "compress",
  targets: ["messages"],
  stackable: true,
  stackPriority: 5,
  metadata: {
    id: "lite",
    name: "Lite",
    description: "Whitespace/format cleanup with opt-in bounded tool-result truncation.",
    inputScope: "messages",
    targetLatencyMs: 1,
    supportsPreview: true,
    stable: true
  },
  apply(body, options) {
    const step = options?.stepConfig ?? {};
    const adapter = adaptBodyForCompression(body);
    const result = applyLiteCompression(adapter.body, {
      preserveSystemPrompt: options?.config?.preserveSystemPrompt,
      truncateToolResults: step.truncateToolResults,
      maxToolLength: step.maxToolLength
    });
    return adapter.adapted ? { ...result, body: adapter.restore(result.body) } : result;
  },
  compress(body, config) {
    return this.apply(body, { stepConfig: config });
  },
  getConfigSchema() {
    return LITE_SCHEMA;
  },
  validateConfig(config) {
    const errors = [];
    if (config.truncateToolResults !== undefined && !isBoolean(config.truncateToolResults)) {
      errors.push("truncateToolResults must be a boolean");
    }
    if (config.maxToolLength !== undefined && resolveLiteMaxToolLength(config.maxToolLength) !== Math.floor(config.maxToolLength)) {
      errors.push(`maxToolLength must be between ${MIN_MAX_TOOL_LENGTH} and ${MAX_MAX_TOOL_LENGTH}`);
    }
    return { valid: errors.length === 0, errors };
  }
};

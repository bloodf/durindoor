import { isString, isObject, isNumber, isBoolean, isFunction, runtimeTypeName } from "../../src/shared/utils/typeChecks.js";
// Ported from OmniRoute release/v3.8.55, open-sse/utils/strictChatHistory.ts.
const MERGED_KEYS = /* @__PURE__ */ new Set(["role", "content", "reasoning_content", "tool_calls"]);
function isBlank(value) {
  if (value === null || value === void 0) return true;
  if (isString(value)) return value === "";
  if (Array.isArray(value)) return value.length === 0;
  if (isObject(value)) return Object.keys(value).length === 0;
  return false;
}
function isRecord(value) {
  return !!value && isObject(value) && !Array.isArray(value);
}
function hasToolCalls(message) {
  if (!isRecord(message)) return false;
  const calls = message.tool_calls;
  if (Array.isArray(calls)) return calls.length > 0;
  return !isBlank(calls);
}
function asContentParts(value) {
  if (Array.isArray(value)) return [...value];
  if (isString(value)) return [{ type: "text", text: value }];
  return [value];
}
function combineContent(first, second) {
  if (isBlank(first)) return second;
  if (isBlank(second)) return first;
  if (isString(first) && isString(second)) return `${first}
${second}`;
  return [...asContentParts(first), ...asContentParts(second)];
}
function combineReasoning(first, second) {
  if (isBlank(first)) return second;
  if (isBlank(second)) return first;
  if (first === second) return first;
  if (isString(first) && isString(second)) return `${first}
${second}`;
  if (Array.isArray(first) && Array.isArray(second)) return [...first, ...second];
  return first;
}
function mergeAssistantPair(first, second) {
  const merged = { ...first };
  merged.content = combineContent(first.content, second.content);
  for (const [key, value] of Object.entries(second)) {
    if (MERGED_KEYS.has(key)) continue;
    if (!(key in merged) || isBlank(merged[key])) merged[key] = value;
  }
  const reasoning = combineReasoning(first.reasoning_content, second.reasoning_content);
  if (!isBlank(reasoning)) merged.reasoning_content = reasoning;
  if (hasToolCalls(second)) merged.tool_calls = second.tool_calls;
  return merged;
}
function mergeAdjacentAssistantMessages(messages) {
  if (messages.length < 2) return messages;
  const out = [];
  let changed = false;
  for (const message of messages) {
    const previous = out.length > 0 ? out[out.length - 1] : void 0;
    if (isRecord(message) && isRecord(previous) && message.role === "assistant" && previous.role === "assistant" && hasToolCalls(message) && !hasToolCalls(previous)) {
      out[out.length - 1] = mergeAssistantPair(previous, message);
      changed = true;
      continue;
    }
    out.push(message);
  }
  return changed ? out : messages;
}
function contentIsEmpty(message) {
  if (!isRecord(message)) return true;
  const content = message.content;
  if (content === null || content === void 0) return true;
  if (isString(content)) return content.trim() === "";
  if (Array.isArray(content)) return content.length === 0;
  if (isObject(content)) return Object.keys(content).length === 0;
  return false;
}
function preferResult(existing, candidate) {
  if (existing === void 0) return candidate;
  if (contentIsEmpty(existing) && !contentIsEmpty(candidate)) return candidate;
  return existing;
}
function toolCallIds(message) {
  if (!isRecord(message)) return [];
  const calls = message.tool_calls;
  if (!Array.isArray(calls)) return [];
  const ids = [];
  for (const call of calls) {
    if (isRecord(call) && isString(call.id) && call.id) ids.push(call.id);
  }
  return ids;
}
function flushGroup(state) {
  for (const callId of state.order) {
    const result = state.results.get(callId);
    if (result === void 0) continue;
    state.closed.set(callId, state.out.length);
    state.out.push(result);
  }
  for (const [callId, result] of state.results) {
    if (state.order.includes(callId)) continue;
    state.closed.set(callId, state.out.length);
    state.out.push(result);
  }
  state.out.push(...state.deferred);
  state.order = [];
  state.results = /* @__PURE__ */ new Map();
  state.deferred.length = 0;
}
function pushHeld(state, message) {
  if (state.order.length > 0) state.deferred.push(message);
  else state.out.push(message);
}
function acceptToolResult(state, message) {
  const callId = isString(message.tool_call_id) ? message.tool_call_id : void 0;
  if (state.order.length > 0) {
    if (callId !== void 0) {
      state.results.set(callId, preferResult(state.results.get(callId), message));
    }
    if (state.order.every((known) => state.results.has(known))) flushGroup(state);
    return;
  }
  if (callId === void 0 || !state.closed.has(callId)) {
    state.out.push(message);
    return;
  }
  const index = state.closed.get(callId);
  if (preferResult(state.out[index], message) === message) {
    state.out[index] = message;
  }
}
function openCallGroup(state, message, ids) {
  if (state.order.length > 0) flushGroup(state);
  state.closed.clear();
  state.out.push(message);
  state.order.push(...ids);
}
function sameOrder(next, original) {
  return next.length === original.length && next.every((value, index) => value === original[index]);
}
function normalizeToolSequence(messages) {
  if (messages.length < 2) return messages;
  const state = {
    out: [],
    deferred: [],
    order: [],
    results: /* @__PURE__ */ new Map(),
    closed: /* @__PURE__ */ new Map()
  };
  for (const message of messages) {
    if (!isRecord(message)) {
      pushHeld(state, message);
      continue;
    }
    if (message.role === "tool") {
      acceptToolResult(state, message);
      continue;
    }
    const ids = toolCallIds(message);
    if (ids.length > 0) openCallGroup(state, message, ids);
    else pushHeld(state, message);
  }
  if (state.order.length > 0) flushGroup(state);
  return sameOrder(state.out, messages) ? messages : state.out;
}
function mergeUserPair(first, second) {
  const merged = { ...first };
  merged.content = combineContent(first.content, second.content);
  for (const [key, value] of Object.entries(second)) {
    if (key === "role" || key === "content") continue;
    if (!(key in merged) || isBlank(merged[key])) merged[key] = value;
  }
  return merged;
}
function isSameRolePair(message, previous, role) {
  return isRecord(message) && isRecord(previous) && message.role === role && previous.role === role;
}
function mergeAdjacentUserMessages(messages) {
  if (messages.length < 2) return messages;
  const out = [];
  let mergedAny = false;
  for (const message of messages) {
    const previous = out.length > 0 ? out[out.length - 1] : void 0;
    if (isSameRolePair(message, previous, "user")) {
      out[out.length - 1] = mergeUserPair(previous, message);
      mergedAny = true;
      continue;
    }
    out.push(message);
  }
  return mergedAny ? out : messages;
}
function isToolMessage(message) {
  return isRecord(message) && message.role === "tool";
}
function trailingToolResultRun(messages) {
  let start = messages.length - 1;
  while (start - 1 >= 0 && isToolMessage(messages[start - 1])) start -= 1;
  return { start, sawResult: start <= messages.length - 2 };
}
function foldTrailingCommentary(messages, declaresTools) {
  if (!declaresTools || messages.length < 2) return messages;
  const last = messages[messages.length - 1];
  if (!isRecord(last) || last.role !== "assistant" || hasToolCalls(last)) return messages;
  const { start, sawResult } = trailingToolResultRun(messages);
  const target = start > 0 ? messages[start - 1] : void 0;
  if (!sawResult || !isRecord(target) || target.role !== "assistant" || !hasToolCalls(target)) {
    return messages.slice(0, -1);
  }
  const out = [...messages];
  out[start - 1] = mergeAssistantPair(target, last);
  out.pop();
  return out;
}
function replaceBodyStrings(value, replacements) {
  if (replacements.length === 0) return value;
  if (isString(value)) {
    let out = value;
    for (const [from, to] of replacements) out = out.split(from).join(to);
    return out;
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const replaced = replaceBodyStrings(item, replacements);
      if (replaced !== item) changed = true;
      return replaced;
    });
    return changed ? next : value;
  }
  if (isRecord(value)) {
    let changed = false;
    const next = {};
    for (const [key, item] of Object.entries(value)) {
      const replaced = replaceBodyStrings(item, replacements);
      if (replaced !== item) changed = true;
      next[key] = replaced;
    }
    return changed ? next : value;
  }
  return value;
}
function repairChatHistory(body, options = {}) {
  const { bodyStringReplacements = [], repairSequence = false } = options;
  if (bodyStringReplacements.length === 0 && !repairSequence) return body;
  const sanitized = replaceBodyStrings(body, bodyStringReplacements);
  if (!repairSequence || !isRecord(sanitized) || !Array.isArray(sanitized.messages)) {
    return sanitized;
  }
  let messages = sanitized.messages;
  messages = mergeAdjacentAssistantMessages(messages);
  messages = normalizeToolSequence(messages);
  messages = mergeAdjacentUserMessages(messages);
  messages = foldTrailingCommentary(messages, !isBlank(sanitized.tools));
  if (messages === sanitized.messages) return sanitized;
  return { ...sanitized, messages };
}
export {
  combineContent,
  foldTrailingCommentary,
  mergeAdjacentAssistantMessages,
  mergeAdjacentUserMessages,
  normalizeToolSequence,
  repairChatHistory,
  replaceBodyStrings
};

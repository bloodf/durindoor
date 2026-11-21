// OpenRouter relays explicit `cache_control` breakpoints to Anthropic models on
// its OpenAI-style chat endpoint. Scope is the model family, not the provider:
// OpenRouter serves every vendor under one id, and strict upstreams behind it
// reject unknown part fields, so only `anthropic/*` ever keeps markers.
// Ported from OmniRoute #19755; every other provider/model is untouched.
import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";

/** Anthropic allows four explicit breakpoints per request. */
export const OPENROUTER_CACHE_BREAKPOINT_LIMIT = 4;

const SYSTEM_ROLES = new Set(["system", "developer"]);
const VALID_TTLS = new Set(["5m", "1h"]);

/** True only for the `openrouter` provider with an `anthropic/*` model id. */
export function isOpenRouterAnthropicModel(provider, model) {
  return isString(provider) && provider.toLowerCase() === "openrouter" &&
    isString(model) && model.trim().toLowerCase().startsWith("anthropic/");
}

/** A usable Anthropic marker: `{type:"ephemeral"}` with an optional 5m/1h ttl. */
export function isValidCacheMarker(marker) {
  if (!isObject(marker) || marker === null || Array.isArray(marker)) return false;
  if (marker.type !== "ephemeral") return false;
  return marker.ttl === undefined || VALID_TTLS.has(marker.ttl);
}

const hasOwnMarker = (carrier) => isObject(carrier) && carrier !== null && "cache_control" in carrier;

function withoutMarker(carrier) {
  const { cache_control, ...rest } = carrier;
  return rest;
}

/**
 * Cap an OpenAI-format body at four valid breakpoints, protecting the cached
 * prefix. Invalid markers, message-level markers and markers on `role:"tool"`
 * messages (Anthropic rejects them inside tool_result content) are removed
 * first. When more than four remain, the prefix anchors (last marked tool,
 * last marked leading system/developer part) are kept and the rest are filled
 * with the newest markers. The caller's objects are never mutated.
 */
export function capOpenAICacheBreakpoints(body, limit = OPENROUTER_CACHE_BREAKPOINT_LIMIT) {
  if (!isObject(body) || body === null) return body;
  const tools = Array.isArray(body.tools) ? body.tools.map((tool) => hasOwnMarker(tool) ? { ...tool } : tool) : null;
  const messages = Array.isArray(body.messages) ?
    body.messages.map((message) => {
      if (!isObject(message) || message === null) return message;
      const copy = hasOwnMarker(message) ? withoutMarker(message) : message;
      if (!Array.isArray(copy.content)) return copy;
      if (!copy.content.some(hasOwnMarker)) return copy;
      return { ...copy, content: copy.content.map((part) => hasOwnMarker(part) ? { ...part } : part) };
    }) : null;
  if (!tools && !messages) return body;

  // Request order is tools, then messages — the order Anthropic builds its prefix in.
  const carriers = [];
  for (const tool of tools || []) if (hasOwnMarker(tool)) carriers.push({ carrier: tool, anchor: "tool" });
  for (const message of messages || []) {
    if (!isObject(message) || message === null || !Array.isArray(message.content)) continue;
    const isTool = message.role === "tool";
    for (const part of message.content) {
      if (hasOwnMarker(part)) carriers.push({ carrier: part, anchor: SYSTEM_ROLES.has(message.role) ? "system" : null, drop: isTool });
    }
  }

  const valid = [];
  for (const entry of carriers) {
    if (entry.drop || !isValidCacheMarker(entry.carrier.cache_control)) delete entry.carrier.cache_control;
    else valid.push(entry);
  }
  if (valid.length > limit) {
    const anchors = new Set();
    for (const kind of ["tool", "system"]) {
      const last = valid.findLast((entry) => entry.anchor === kind);
      if (last) anchors.add(last);
    }
    const rest = valid.filter((entry) => !anchors.has(entry));
    const keep = Math.max(0, limit - anchors.size);
    for (const entry of rest.slice(0, rest.length - keep)) delete entry.carrier.cache_control;
  }
  const result = { ...body };
  if (tools) result.tools = tools;
  if (messages) result.messages = messages;
  return result;
}

/**
 * Index of the last message that carries a cache marker; the cached prefix is
 * everything up to and including it (plus tools). -1 when nothing is marked.
 */
export function cachedPrefixEnd(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!isObject(message) || message === null) continue;
    if (hasOwnMarker(message) || Array.isArray(message.content) && message.content.some(hasOwnMarker)) return i;
  }
  return -1;
}

/**
 * Serialize the cached prefix (tools + messages through the last marker) for a
 * byte comparison; null when the body carries no marker, so nothing is protected.
 */
export function serializeCachedPrefix(body) {
  const end = cachedPrefixEnd(body);
  if (end < 0) return null;
  return JSON.stringify({ tools: body.tools ?? null, messages: body.messages.slice(0, end + 1) });
}

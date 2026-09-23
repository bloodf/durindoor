// Adaptive reasoning effort (port of OmniRoute #13448). Deterministic
// low/medium/high thinking-budget resolution from request-shape signals only
// -- no LLM call, no judgment gate. One implementation at the gateway covers
// every harness (Claude Code, Cursor, Codex, opencode) because the full
// request body passes through here before any provider translation.
//
// STATELESS PER-TURN PIN: signals are computed ONLY from the last user
// message and everything BEFORE it. Tool results after the last user message
// are ignored, so every request of the same user turn -- including
// mid-tool-loop requests -- resolves to the SAME level. This never escalates
// mid-loop, which would change the reasoning config between requests and
// cost a cold prompt-cache prefix write on cache-sensitive upstreams.
//
// Priority (highest first), all off-by-default:
// 1. Explicit client reasoning field of any shape -- always wins; no-op.
// 2. `X-DurinDoor-Effort: auto` request header (per-request opt-in), read by
//    open-sse/handlers/chatCore/adaptiveEffortWiring.js.
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";
import { estimateTokens } from "../handlers/countTokensCore.js";

export const ADAPTIVE_EFFORT = "auto";

// Thresholds mirror the upstream resolver: three coarse deterministic bands.
// A near-miss costs a slightly over/under-thought answer, not a wrong route,
// so they stay coarse until call-log data says otherwise.
const TRIVIAL_USER_CHARS = 160;
const TRIVIAL_CTX_TOKENS = 4000;
const HEAVY_CTX_TOKENS = 60000;
const HEAVY_TOOL_RESULTS = 6;
const HEAVY_USER_CHARS = 4000;

function lastUserMessageIndex(messages) {
  let last = -1;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === "user") last = i;
  }
  return last;
}

function messageTextChars(content) {
  if (isString(content)) return content.length;
  if (Array.isArray(content)) {
    let sum = 0;
    for (const part of content) {
      const text = part?.text;
      if (isString(text)) sum += text.length;
    }
    return sum;
  }
  return 0;
}

function countRole(messages, role, from, to) {
  let n = 0;
  for (let i = from; i < to; i++) {
    if (messages[i]?.role === role) n++;
  }
  return n;
}

function toolLoopDepthAfter(messages, boundary) {
  let n = 0;
  for (let i = boundary + 1; i < messages.length; i++) {
    const msg = messages[i];
    if (msg?.role === "assistant" && msg.tool_calls) n++;
  }
  return n;
}

/** Deterministic low/medium/high band from the last user turn's shape. */
export function resolveAdaptiveEffort(messages) {
  const msgs = Array.isArray(messages) ? messages : [];
  if (msgs.length === 0) return "medium"; // no signals at all -> balanced band, never cheap-by-default
  const boundary = lastUserMessageIndex(msgs);
  const upToTurn = boundary >= 0 ? msgs.slice(0, boundary + 1) : msgs;
  const userChars = boundary >= 0 ? messageTextChars(msgs[boundary].content) : 0;
  const estCtxTokens = estimateTokens({ messages: upToTurn });
  const toolResults = boundary >= 0 ? countRole(msgs, "tool", 0, boundary) : 0;
  const turnDepth = boundary >= 0 ? toolLoopDepthAfter(msgs, boundary) + 1 : 1;

  const trivial =
  userChars <= TRIVIAL_USER_CHARS &&
  estCtxTokens <= TRIVIAL_CTX_TOKENS &&
  toolResults === 0 &&
  turnDepth <= 1;
  if (trivial) return "low";
  const heavy =
  estCtxTokens >= HEAVY_CTX_TOKENS ||
  toolResults >= HEAVY_TOOL_RESULTS ||
  userChars >= HEAVY_USER_CHARS;
  if (heavy) return "high";
  return "medium";
}

export function isAdaptiveEffort(value) {
  return isString(value) && value.trim().toLowerCase() === ADAPTIVE_EFFORT;
}

export function hasExplicitReasoningField(body) {
  return (
    body.reasoning_effort !== undefined ||
    body.reasoning !== undefined ||
    body.thinking !== undefined);

}

/**
 * Resolve "auto" to a concrete level when the request opted in (header) and
 * carries no explicit reasoning field. Returns `body` unchanged (same
 * reference) otherwise.
 */
export function applyAdaptiveEffort(body, opts) {
  if (!body || !isObject(body) || Array.isArray(body)) return body;
  if (hasExplicitReasoningField(body)) return body;
  const headerAuto = isAdaptiveEffort(opts?.headerEffort);
  if (!headerAuto) return body;
  const level = resolveAdaptiveEffort(opts?.messages ?? body.messages);
  return { ...body, reasoning_effort: level };
}

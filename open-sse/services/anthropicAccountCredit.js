// OmniRoute #21076 (77b4f9efd236): Anthropic's out-of-credit answer is an HTTP 400
// typed `invalid_request_error`. The balance belongs to the whole API key, so it
// benches the connection, also on an anthropic-compatible-* node. The match stays
// narrow (leading phrase inside Anthropic's envelope) because a 400 can echo input.
//
// OmniRoute PR #21440 (head 115338ff9f3f, open, MIT) adds the second account-level
// 400, the spend cap an operator sets in the Anthropic console:
//   "You have reached your specified API usage limits. You will regain access on
//    YYYY-MM-DD at HH:MM UTC."
// It also accepts the `claude` provider identity. The stated reset is the
// authoritative end of the pause; `parseAnthropicRegainAccessResetMs` reads it.
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";

const CREDIT_PHRASES = Object.freeze([
  "your credit balance is too low",
  "you have reached your specified api usage limits",
]);
const CREDIT_ERROR_TYPES = new Set(["invalid_request_error", "billing_error"]);
const STATUS_PREFIX = /^\[400\]:\s*/;

export function isAnthropicCreditProvider(provider) {
  if (!isString(provider)) return false;
  const id = provider.toLowerCase();
  return id === "anthropic" || id === "claude" || id.startsWith("anthropic-compatible-");
}

function startsWithCreditPhrase(message) {
  const lower = message.trim().toLowerCase();
  return CREDIT_PHRASES.some((phrase) => lower.startsWith(phrase));
}

/**
 * The provider-authored message of an Anthropic credit/usage-limit 400, or null.
 * Accepts Anthropic's JSON envelope, or its bare message (optionally "[400]: "-prefixed).
 * The phrase must lead the message: a 400 that quotes it mid-message is caller input.
 */
export function anthropicAccountCreditMessage(errorText, structuredError = null) {
  let body = structuredError;
  const text = isString(errorText) ? errorText.trim().replace(STATUS_PREFIX, "") : "";
  if (!body) {
    if (!text.startsWith("{")) return startsWithCreditPhrase(text) ? text : null;
    try { body = JSON.parse(text); } catch { return null; }
  }
  if (!isObject(body) || body.type !== "error" || !CREDIT_ERROR_TYPES.has(body.error?.type)) return null;
  const message = body.error.message;
  return isString(message) && startsWithCreditPhrase(message) ? message : null;
}

/** True for Anthropic's JSON envelope, or its bare message (optionally "[400]: "-prefixed). */
export function isAnthropicAccountCreditExhausted(errorText, structuredError = null) {
  return anthropicAccountCreditMessage(errorText, structuredError) !== null;
}

// "regain access on 2026-12-01 at 00:00 UTC" (the wire form), also with a `T`/space
// separator, seconds, and a `Z`, `UTC` or `±HH:MM`/`±HHMM` zone. No zone means UTC,
// as in the upstream parser. Only this anchored clause is read: a generic
// "retry in 60s" elsewhere in the text is a transient hint, not the billing reset.
const REGAIN_ACCESS =
  /\bregain access on\s+(\d{4})-(\d{2})-(\d{2})(?:[Tt]|\s+at\s+|\s+)(\d{2}):(\d{2})(?::(\d{2}))?\s*(UTC|Z|[+-]\d{2}:?\d{2})?(?![\d:])/i;

/**
 * Absolute reset (epoch ms) stated by an Anthropic usage-limit message, or null.
 * Impossible calendar dates/times, out-of-range offsets and past instants are
 * rejected. A future reset beyond `maxDelayMs` is clamped to now + maxDelayMs.
 * @param {string|null|undefined} message
 * @param {number} [now]
 * @param {number} [maxDelayMs]
 * @returns {number|null}
 */
export function parseAnthropicRegainAccessResetMs(message, now = Date.now(), maxDelayMs = Infinity) {
  if (!isString(message)) return null;
  const match = REGAIN_ACCESS.exec(message);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null;
  const local = Date.UTC(year, month - 1, day, hour, minute, second);
  const probe = new Date(local);
  // Date.UTC rolls 2026-02-30 over to March: accept only a real calendar day.
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  let offsetMs = 0;
  const zone = match[7]?.toUpperCase();
  if (zone && zone !== "UTC" && zone !== "Z") {
    const digits = zone.slice(1).replace(":", "");
    const offH = Number(digits.slice(0, 2));
    const offM = Number(digits.slice(2, 4));
    if (offH > 14 || offM > 59) return null;
    offsetMs = (zone[0] === "-" ? -1 : 1) * (offH * 60 + offM) * 60_000;
  }
  const resetMs = local - offsetMs;
  const clock = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  if (!Number.isFinite(resetMs) || resetMs <= clock) return null;
  const cap = Number(maxDelayMs);
  return Number.isFinite(cap) && cap > 0 ? Math.min(resetMs, clock + cap) : resetMs;
}

// MiniMax Code gateway budgets: call budget, input-size ceiling, context window, default
// max tokens and the retry count of the managed gateway transport.
//
// Ported from OmniRoute release/v3.8.55 (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/executors/minimaxCodeGateway.ts and minimax-code.ts (MIT), with the same defaults
// and the same `MINIMAX_CODE_*` environment names. The values are read on every call so an
// operator can change them without a restart.
import { isRecord } from "../../src/shared/utils/typeChecks.js";

/** Context window the gateway answers in; also the ceiling for the input estimate. */
export const MINIMAX_CODE_MAX_CONTEXT_WINDOW = 1_000_000;
/** The window the model catalog declares as the default. Asking for it narrows the request. */
export const MINIMAX_CODE_CATALOG_CONTEXT_WINDOW = 512_000;
/** `max_tokens` sent when the request does not carry one. */
export const MINIMAX_CODE_DEFAULT_MAX_TOKENS = 8192;
/** Budget of one whole call: the attempt, the backoff and the retry. */
export const MINIMAX_CODE_DEFAULT_TIMEOUT_MS = 100_000;
/** Retries on a 429, a 5xx or a dropped connection. 4xx other than 429 are never retried. */
export const MINIMAX_CODE_DEFAULT_RETRIES = 1;
/** Hard ceiling for a configured retry count, so a typo cannot hold a model slot for minutes. */
export const MINIMAX_CODE_MAX_RETRIES = 3;
export const MINIMAX_CODE_DEFAULT_RETRY_BASE_MS = 1000;
export const MINIMAX_CODE_MAX_BACKOFF_MS = 30_000;

// Chars per token, per script. A single ratio would have to be the worst case for every
// script; a ratio that is too small lets through the payload the gateway rejects.
const LATIN_CHARS_PER_TOKEN = 3;
const CYRILLIC_CHARS_PER_TOKEN = 2;
const WIDE_CHARS_PER_TOKEN = 1;

const positiveInteger = (raw) => {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
};

/** `MINIMAX_CODE_CONTEXT_WINDOW`: only the catalog default (512000) narrows; anything else is ignored. */
export function resolveMinimaxCodeContextWindow(env = process.env) {
  return Number(env.MINIMAX_CODE_CONTEXT_WINDOW) === MINIMAX_CODE_CATALOG_CONTEXT_WINDOW
    ? MINIMAX_CODE_CATALOG_CONTEXT_WINDOW
    : MINIMAX_CODE_MAX_CONTEXT_WINDOW;
}

/** `MINIMAX_CODE_MAX_INPUT_TOKENS` lowers the ceiling; it cannot raise it above the window. */
export function resolveMinimaxCodeInputLimit(env = process.env) {
  const window = resolveMinimaxCodeContextWindow(env);
  const configured = positiveInteger(env.MINIMAX_CODE_MAX_INPUT_TOKENS);
  return configured === null ? window : Math.min(configured, window);
}

/** The request's own `max_tokens` wins, then `MINIMAX_CODE_MAX_TOKENS`, then 8192. */
export function resolveMinimaxCodeMaxTokens(body, env = process.env) {
  return positiveInteger(body?.max_tokens) ?? positiveInteger(body?.max_completion_tokens)
    ?? positiveInteger(env.MINIMAX_CODE_MAX_TOKENS) ?? MINIMAX_CODE_DEFAULT_MAX_TOKENS;
}

/** `MINIMAX_CODE_GATEWAY_TIMEOUT_MS`; zero, negative or non-numeric values fall back to the default. */
export function resolveMinimaxCodeTimeoutMs(env = process.env) {
  return positiveInteger(env.MINIMAX_CODE_GATEWAY_TIMEOUT_MS) ?? MINIMAX_CODE_DEFAULT_TIMEOUT_MS;
}

/** `MINIMAX_CODE_GATEWAY_RETRIES`: 0 turns the retry off, default 1, capped at 3. */
export function resolveMinimaxCodeRetries(env = process.env) {
  const raw = env.MINIMAX_CODE_GATEWAY_RETRIES;
  if (raw === undefined || raw === "") return MINIMAX_CODE_DEFAULT_RETRIES;
  const value = Number(raw);
  if (!Number.isFinite(value)) return MINIMAX_CODE_DEFAULT_RETRIES;
  return Math.min(MINIMAX_CODE_MAX_RETRIES, Math.max(0, Math.floor(value)));
}

/** Exponential backoff before retry `attempt` (1-based): base, 2x base, ... up to 30 s. */
export function minimaxCodeBackoffMs(attempt, baseMs = MINIMAX_CODE_DEFAULT_RETRY_BASE_MS) {
  return Math.min(baseMs * 2 ** Math.max(0, attempt - 1), MINIMAX_CODE_MAX_BACKOFF_MS);
}

/** Only a quota (429) or an outage (5xx) is worth another try; any other 4xx is the request's own. */
export function isRetryableMinimaxCodeStatus(status) {
  return status === 429 || status >= 500;
}

/** CJK, Hiragana, Katakana, Hangul and the CJK compatibility ideographs. */
const isWide = (code) => (code >= 0x3000 && code <= 0x9fff) || (code >= 0xac00 && code <= 0xd7af) || (code >= 0xf900 && code <= 0xfaff);
const isCyrillic = (code) => code >= 0x0400 && code <= 0x052f;

/**
 * Pessimistic estimate of the input tokens of an Anthropic Messages payload. The gateway does
 * not report the input size before it generates, so the size comes from the serialized prompt:
 * messages, system and the tool catalog (usually the largest part of an agentic request).
 */
export function estimateMinimaxCodeInputTokens(body) {
  const doc = isRecord(body) ? body : {};
  const text = JSON.stringify(doc.messages ?? []) + JSON.stringify(doc.system ?? []) + JSON.stringify(doc.tools ?? []);
  let wide = 0;
  let cyrillic = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (isWide(code)) wide += 1;
    else if (isCyrillic(code)) cyrillic += 1;
  }
  const latin = text.length - wide - cyrillic;
  return Math.ceil(wide / WIDE_CHARS_PER_TOKEN) + Math.ceil(cyrillic / CYRILLIC_CHARS_PER_TOKEN) + Math.ceil(latin / LATIN_CHARS_PER_TOKEN);
}

/**
 * Apply the budgets to a request body. Returns `{ body }` with the default `max_tokens` and,
 * when narrowed, `context_window` set, or `{ error }` when the estimated input is over the ceiling.
 */
export function applyMinimaxCodeBudgets(body, env = process.env) {
  const next = isRecord(body) ? { ...body } : {};
  const limit = resolveMinimaxCodeInputLimit(env);
  const tokens = estimateMinimaxCodeInputTokens(next);
  if (tokens > limit) {
    return {
      error: `MiniMax Code request is too large for the managed gateway transport: ~${tokens} input tokens (limit ${limit}). Trim the conversation and retry.`,
    };
  }
  next.max_tokens = resolveMinimaxCodeMaxTokens(next, env);
  delete next.max_completion_tokens;
  const window = resolveMinimaxCodeContextWindow(env);
  if (window < MINIMAX_CODE_MAX_CONTEXT_WINDOW) next.context_window = window;
  return { body: next };
}

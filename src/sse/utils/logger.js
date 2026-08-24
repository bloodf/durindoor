import { isString } from "../../shared/utils/typeChecks.js"; /**
 * Logger utility for the SSE layer. Leveled helpers (`debug`/`info`/`warn`/
 * `error`) honor `LOG_LEVEL`; the unified request-lifecycle helpers below
 * (`nextTag`, `tagForSession`, `line`, `errorLine`, `fmtThink`) print correlated
 * lifecycle lines (request, saver, completion/error), color-keyed by session.
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

const LEVEL = LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase?.()] ?? LOG_LEVELS.INFO;

function formatTime() {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

// Colored-dot tags to correlate request lines by session (same session → same color)
const REQ_TAGS = ["🟢", "🔵", "🟣", "🟡", "🟠", "🔴", "⚪", "🟤"];
let tagCursor = 0;

/**
 * Allocate the next rotating colored-dot tag. Fallback when no session seed
 * is available; successive calls cycle through `REQ_TAGS`.
 * @returns {string} One of the colored-dot tag glyphs.
 */
export function nextTag() {
  const tag = REQ_TAGS[tagCursor % REQ_TAGS.length];
  tagCursor++;
  return tag;
}

/**
 * Stable colored-dot tag for a session/connection seed: the same seed always
 * hashes to the same color, so all lines of one CLI conversation correlate.
 * @param {string} [seed] - Session/connection id; falsy falls back to `nextTag()`.
 * @returns {string} One of the colored-dot tag glyphs.
 */
export function tagForSession(seed) {
  if (!seed) return nextTag();
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = h * 31 + seed.charCodeAt(i) | 0;
  return REQ_TAGS[Math.abs(h) % REQ_TAGS.length];
}

/**
 * Print one correlated INFO line: `[time] tag symbol message`. Suppressed when
 * `LOG_LEVEL` is above INFO.
 * @param {string} tag - Session tag glyph (from `tagForSession`/`nextTag`).
 * @param {string} symbol - Phase marker (e.g. "→", "⚙", "✓").
 * @param {string} message - Line body.
 */
export function line(tag, symbol, message) {
  if (LEVEL > LOG_LEVELS.INFO) return;
  console.log(`[${formatTime()}] ${tag} ${symbol} ${message}`);
}

/**
 * Like `line()` but always printed regardless of `LOG_LEVEL` (errors must
 * never be hidden).
 * @param {string} tag - Session tag glyph.
 * @param {string} symbol - Phase marker (e.g. "✗").
 * @param {string} message - Line body.
 */
export function errorLine(tag, symbol, message) {
  console.log(`[${formatTime()}] ${tag} ${symbol} ${message}`);
}

/**
 * Format the thinking intent for the request line.
 * @param {object} [intent] - `{ mode, budget, level }` from thinking extraction.
 * @returns {string|null} `"off"`, `"auto"`, budget as `"10k"`, the level name,
 *   or `null` when absent/unrecognized.
 */
export function fmtThink(intent) {
  if (!intent || !intent.mode) return null;
  if (intent.mode === "none") return "off";
  if (intent.mode === "auto") return "auto";
  if (intent.mode === "budget") {
    const k = intent.budget >= 1000 ? `${Math.round(intent.budget / 1000)}k` : `${intent.budget}`;
    return k;
  }
  if (intent.mode === "level") return intent.level;
  return null;
}

function formatData(data) {
  if (!data) return "";
  if (isString(data)) return data;
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

export function debug(tag, message, data) {
  if (LEVEL <= LOG_LEVELS.DEBUG) {
    const dataStr = data ? ` ${formatData(data)}` : "";
    console.log(`[${formatTime()}] 🔍 [${tag}] ${message}${dataStr}`);
  }
}

export function info(tag, message, data) {
  if (LEVEL <= LOG_LEVELS.INFO) {
    const dataStr = data ? ` ${formatData(data)}` : "";
    console.log(`[${formatTime()}] ℹ️  [${tag}] ${message}${dataStr}`);
  }
}

export function warn(tag, message, data) {
  if (LEVEL <= LOG_LEVELS.WARN) {
    const dataStr = data ? ` ${formatData(data)}` : "";
    console.warn(`[${formatTime()}] ⚠️  [${tag}] ${message}${dataStr}`);
  }
}

export function error(tag, message, data) {
  if (LEVEL <= LOG_LEVELS.ERROR) {
    const dataStr = data ? ` ${formatData(data)}` : "";
    console.log(`[${formatTime()}] ❌ [${tag}] ${message}${dataStr}`);
  }
}

export function request(method, path, extra) {
  const dataStr = extra ? ` ${formatData(extra)}` : "";
  console.log(`\x1b[36m[${formatTime()}] 📥 ${method} ${path}${dataStr}\x1b[0m`);
}

export function response(status, duration, extra) {
  const icon = status < 400 ? "📤" : "💥";
  const dataStr = extra ? ` ${formatData(extra)}` : "";
  console.log(`[${formatTime()}] ${icon} ${status} (${duration}ms)${dataStr}`);
}

export function stream(event, data) {
  const dataStr = data ? ` ${formatData(data)}` : "";
  console.log(`[${formatTime()}] 🌊 [STREAM] ${event}${dataStr}`);
}

// Mask sensitive data
export function maskKey(key) {
  if (!key || key.length < 8) return "***";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
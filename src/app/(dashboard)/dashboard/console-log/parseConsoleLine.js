const TIMESTAMP_RE = /^\s*\[(\d{2}:\d{2}:\d{2})\]\s*/;
const BRACKET_TAG_RE = /\[([A-Za-z][\w.-]*)\]/g;
const LEVEL_MARKERS = new Set(["ERROR", "WARN", "INFO", "DEBUG"]);
const VERB_TAGS = new Set(["POST", "DONE", "GET", "CANCELLED"]);
const HAS_WORD_CHAR = /[A-Za-z0-9]/;

export const CONSOLE_LEVELS = ["error", "warn", "info", "debug"];

function detectLevel(text) {
  if (text.includes("❌") || text.includes("[ERROR]") || text.includes("Error:")) return "error";
  if (text.includes("⚠") || text.includes("[WARN]")) return "warn";
  if (text.includes("[DEBUG]")) return "debug";
  return "info";
}

function detectTag(message) {
  for (const match of message.matchAll(BRACKET_TAG_RE)) {
    if (!LEVEL_MARKERS.has(match[1])) return match[1];
  }
  const firstWord = message.split(/\s+/).find((token) => HAS_WORD_CHAR.test(token));
  return firstWord && VERB_TAGS.has(firstWord) ? firstWord : null;
}

/**
 * Parses one captured console line into the fields the Console Log viewer
 * filters and renders. Lines come from `src/lib/consoleLogBuffer.js` with ANSI
 * codes already stripped; the gateway logger writes them as
 * `[HH:MM:SS] <glyphs> [TAG] message` or `[HH:MM:SS] 🟢 → POST …`.
 *
 * - `ts`: the leading `[HH:MM:SS]` stamp, or `null`.
 * - `level`: `❌`, `[ERROR]` or `Error:` → `error`; `⚠️` or `[WARN]` → `warn`;
 *   `[DEBUG]` → `debug`; anything else → `info`.
 * - `tag`: the first `[WORD]` token that is not a level marker (`HEADROOM`,
 *   `TIER`, …); otherwise the first word when it is `POST`, `DONE`, `GET` or
 *   `CANCELLED`, skipping the leading session/phase glyphs; otherwise `null`.
 * - `message`: the line without its timestamp prefix.
 *
 * @param {string} raw Captured console line.
 * @returns {{ ts: string|null, level: "error"|"warn"|"info"|"debug", tag: string|null, message: string, raw: string }}
 */
export function parseConsoleLine(raw) {
  const text = String(raw ?? "");
  const stamp = text.match(TIMESTAMP_RE);
  const message = stamp ? text.slice(stamp[0].length) : text;
  return {
    ts: stamp ? stamp[1] : null,
    level: detectLevel(text),
    tag: detectTag(message),
    message,
    raw: text,
  };
}

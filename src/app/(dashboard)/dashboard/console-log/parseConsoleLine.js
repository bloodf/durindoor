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

// Match the formatter's field order so free text such as the account name
// cannot be mistaken for a mode or count. Unknown layouts remain raw rows.
function parseRequest(message) {
  const match = message.match(/^[^\p{L}\p{N}]*POST (?<model>.+?) → (?<routedModel>.+?) · FMT: (?<format>.+?) · (?<mode>STREAM|JSON) · (?<messages>\d+) MSG(?: · (?<tools>\d+) TOOL)?(?: · THINK:(?<thinking>[^\n]+?))? · ACC:(?<account>[\s\S]*)$/u);
  if (!match) return null;
  const { model, routedModel, format, mode, messages, tools, thinking, account } = match.groups;
  const request = {
    model, routedModel, format, mode, messages: Number(messages),
    tools: tools === undefined ? null : Number(tools),
    account,
  };
  if (thinking !== undefined) request.thinking = thinking;
  return request;
}

function parseCompletion(message) {
  const [body, ...suffix] = message.split(" · ");
  const total = body.match(/^[^\p{L}\p{N}]*DONE (\d+)\s*ms$/u);
  if (!total) return null;

  const ttft = suffix[0]?.match(/^TTFT (\d+)\s*ms$/);
  if (ttft) suffix.shift();
  const input = suffix.shift()?.match(/^IN (\d+)(?: \(CACHE (?:↻(\d+))? ?(?:\+(\d+))?\)(?: (\d+(?:\.\d+)?)% reused)?)?$/);
  const output = suffix.shift()?.match(/^OUT (\d+)$/);
  if (!input || !output) return null;

  const session = suffix.at(-1)?.match(/^sid:(.*)$/);
  if (session) suffix.pop();
  const credits = suffix.at(-1)?.match(/^(\d+(?:\.\d+)?(?:e\+\d+)?)cr$/);
  if (credits) suffix.pop();
  if (suffix.length > 1) return null;

  const completion = {
    totalMs: Number(total[1]),
    ttftMs: ttft ? Number(ttft[1]) : null,
    inputTokens: Number(input[1]),
    outputTokens: Number(output[1]),
    cacheRead: Number(input[2] ?? 0),
    cacheCreate: Number(input[3] ?? 0),
    routedModel: suffix[0] ?? null,
  };
  if (input[4]) completion.cacheReusedPercent = Number(input[4]);
  if (credits) completion.credits = Number(credits[1]);
  if (session) completion.sessionId = session[1];
  return completion;
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
 * - `message`: the line without its timestamp prefix, displayed in Wrap lines mode.
 * - `raw`: the original captured line, including its timestamp.
 *
 * @param {string} raw Captured console line.
 * @returns {{ ts: string|null, level: "error"|"warn"|"info"|"debug", tag: string|null, message: string, raw: string }}
 */
export function parseConsoleLine(raw) {
  const text = String(raw ?? "");
  const stamp = text.match(TIMESTAMP_RE);
  const message = stamp ? text.slice(stamp[0].length) : text;
  const request = parseRequest(message);
  const completion = parseCompletion(message);
  const entry = {
    ts: stamp ? stamp[1] : null,
    level: detectLevel(text),
    tag: detectTag(message),
    message,
    raw: text,
  };
  if (request) entry.request = request;
  if (completion) entry.completion = completion;
  return entry;
}

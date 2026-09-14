// Server console lines in the formats src/sse/utils/logger.js and chatCore
// print (request ▶, saver ⚙, DONE 📊, ERROR ✗, leveled [TAG] lines).
import { LANES } from "./usageLanes.js";

const TAGS = ["🟢", "🔵", "🟣", "🟡", "🟠", "🔴", "⚪", "🟤"];
const CLIENT_MODEL = { "/v1/messages": "claude-sonnet-5", "/v1/responses": "gpt-6-astra", "/v1/chat/completions": null };

const clock = (ms) => new Date(ms).toLocaleTimeString("en-US", { hour12: false });

function tagFor(seed) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  return TAGS[Math.abs(hash) % TAGS.length];
}

/** Two or three lines describing one request event. */
export function linesForEvent(event) {
  const lane = LANES[event.laneIndex];
  const tag = tagFor(event.traceId);
  const doneAt = new Date(event.timestamp).getTime();
  const startAt = doneAt - event.latency.total;
  const clientModel = event.comboName || CLIENT_MODEL[event.endpoint] || `${lane.alias}/${lane.model}`;
  const format = event.endpoint === "/v1/messages" ? "claude" : event.endpoint === "/v1/responses" ? "openai-responses" : "openai";
  const target = ["claude", "anthropic", "kiro"].includes(lane.provider) ? "claude" : lane.provider === "codex" ? "openai-responses" : "openai";
  const fmt = format === target ? `FMT: ${format} (passthrough)` : `FMT: ${format}→${target}`;
  const messages = 4 + (event.promptTokens % 23);
  const lines = [`[${clock(startAt)}] ${tag} ▶ POST ${clientModel} → ${lane.provider}/${lane.model} · ${fmt} · STREAM · ${messages} MSG · ${messages % 3 ? `${messages % 7 + 3} TOOL · ` : ""}ACC:${lane.accountName}`];
  if (event.promptTokens > 20_000) {
    lines.push(`[${clock(startAt + 3)}] ${tag} ⚙ RTK:-${(event.promptTokens / 900).toFixed(1)}KB · HEADROOM:-${Math.round(event.promptTokens * 0.04)}tok`);
  }
  if (event.httpStatus !== 200) {
    lines.push(`[${clock(doneAt)}] ${tag} ✗ ERROR ${event.httpStatus} · ${lane.provider}/${lane.model} · ${event.latency.total}ms\n    ${event.error}`);
    return lines;
  }
  const t = event.tokens;
  const cacheRead = t.cache_read_input_tokens || t.cached_tokens || 0;
  const cacheParts = [cacheRead ? `↻${cacheRead}` : null, t.cache_creation_input_tokens ? `+${t.cache_creation_input_tokens}` : null].filter(Boolean);
  const inText = cacheParts.length ? `IN ${event.promptTokens} (CACHE ${cacheParts.join(" ")})` : `IN ${event.promptTokens}`;
  lines.push(`[${clock(doneAt)}] ${tag} 📊 DONE ${event.latency.total}ms · TTFT ${event.latency.ttft}ms · ${inText} · OUT ${event.completionTokens} · ${lane.provider}/${lane.model}`);
  return lines;
}

const HOUSEKEEPING = [
  (ms) => `[${clock(ms)}] ℹ️  [INFO] [TOKEN] refreshed codex OAuth token for balin@erebor.dev (expires in 3600s)`,
  (ms) => `[${clock(ms)}] ⚠️  [WARN] [FALLBACK] cc/claude-sonnet-5 429 on balin@erebor.dev → cx/gpt-6-astra (combo daily-coder)`,
  (ms) => `[${clock(ms)}] ❌ [ERROR] [QUOTA] cursor balin@erebor.dev: Monthly quota exhausted (402)`,
  (ms) => `[${clock(ms)}] ⚠️  [WARN] [COOLDOWN] codex dwalin@erebor.dev rate limited, cooling down 60s`,
  (ms) => `[${clock(ms)}] 🔍 [DEBUG] [OBSERVABILITY] flushed 20 request details`,
  (ms) => `[${clock(ms)}] ℹ️  [INFO] [PROXY] pool Erebor egress healthy (38ms)`,
  (ms) => `[${clock(ms)}] ℹ️  [INFO] [USAGE] daily rollup updated`,
];

export function housekeepingLine(index, ms) {
  return HOUSEKEEPING[index % HOUSEKEEPING.length](ms);
}

/** Buffered lines for the last stretch of seeded requests, oldest first. */
export function seedConsoleLines(events, nowMs) {
  const lines = [...events].reverse().flatMap((event, index) => [
    ...linesForEvent(event),
    ...(index % 9 === 4 ? [housekeepingLine(index, new Date(event.timestamp).getTime() + 250)] : []),
  ]);
  return [`[${clock(nowMs - 3_600_000)}] ℹ️  [INFO] [SERVER] DurinDoor listening on http://localhost:20128`, ...lines];
}

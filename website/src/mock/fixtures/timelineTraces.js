// Proxy timeline traces (src/lib/db/repos/proxyTimelineRepo.js rows). Trace
// rows are built from the usage request events; per-trace events are derived
// on demand from private `_` fields so localStorage only holds the rows.
import { LANES } from "./usageLanes.js";
import { MINUTE_MS, seeded } from "./world.js";

export const FALLBACK_TRACE_ID = "5f0c2a7e-9d14-4b6e-a3c1-2d7e8f90b1aa";

const CLIENT_FORMAT = { "/v1/messages": "claude", "/v1/responses": "openai-responses", "/v1/chat/completions": "openai" };
const PROVIDER_FORMAT = { claude: "claude", anthropic: "claude", kiro: "claude", codex: "openai-responses", "gemini-cli": "gemini-cli", antigravity: "antigravity", cursor: "cursor" };
const HOSTS = {
  claude: "api.anthropic.com/v1/messages",
  anthropic: "api.anthropic.com/v1/messages",
  codex: "chatgpt.com/backend-api/codex/responses",
  "gemini-cli": "cloudcode-pa.googleapis.com/v1internal:streamGenerateContent",
  github: "api.githubcopilot.com/chat/completions",
  antigravity: "daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent",
  kiro: "codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse",
  cursor: "api2.cursor.sh/aiserver.v1.ChatService/StreamUnifiedChatWithTools",
  groq: "api.groq.com/openai/v1/chat/completions",
  openrouter: "openrouter.ai/api/v1/chat/completions",
  deepseek: "api.deepseek.com/chat/completions",
  "ollama-local": "localhost:11434/v1/chat/completions",
  "openai-compatible-ravenhill": "llm.ravenhill.internal/v1/chat/completions",
};
const TEXT = [
  "Looking at", " the failing", " test, the", " retry loop", " never resets", " its backoff", " counter. I", " moved the reset", " into the success", " branch and", " added a regression", " test."];

const providerFormat = (provider) => PROVIDER_FORMAT[provider] || "openai";

function hashSeed(text) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) | 0;
  return hash >>> 0;
}

function chunkPayload(format, text) {
  if (format === "claude") return { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } };
  if (format === "openai-responses") return { type: "response.output_text.delta", delta: text };
  if (format === "gemini-cli" || format === "antigravity") return { response: { candidates: [{ content: { role: "model", parts: [{ text }] } }] } };
  return { choices: [{ index: 0, delta: { content: text } }] };
}

export function traceFromEvent(event, kind = event.httpStatus === 200 ? "normal" : "error") {
  const lane = LANES[event.laneIndex];
  const startedMs = new Date(event.timestamp).getTime() - event.latency.total;
  const trace = {
    id: event.traceId,
    started_at: new Date(startedMs).toISOString(),
    ended_at: event.timestamp,
    status: kind === "error" ? "error" : "ok",
    provider: lane.provider,
    model: lane.model,
    connection_id: lane.connectionId,
    api_key_id: event.apiKeyId,
    endpoint: event.endpoint,
    client_format: CLIENT_FORMAT[event.endpoint] || "openai",
    provider_format: providerFormat(lane.provider),
    fallback_count: kind === "fallback" ? 1 : 0,
    ttft_ms: kind === "error" ? null : event.latency.ttft,
    total_ms: event.latency.total,
    redacted: 1,
    truncated: 0,
    _kind: kind,
    _tokens: { prompt_tokens: event.promptTokens, completion_tokens: event.completionTokens },
    _httpStatus: event.httpStatus,
    _error: event.error,
  };
  const events = traceEvents(trace);
  const payloadBytes = events.reduce((sum, item) => sum + JSON.stringify(item.payload ?? null).length, 0);
  return { ...trace, event_count: events.length, payload_bytes: payloadBytes };
}

/** Turn a normal/error usage event into the daily-coder fallback story. */
export function fallbackFromEvent(event, id = event.traceId) {
  const codex = LANES.find((lane) => lane.connectionId === "conn-codex-main" && lane.model === "gpt-6-astra");
  return traceFromEvent({ ...event, traceId: id, laneIndex: codex.index, apiKeyId: "key-agents", endpoint: "/v1/chat/completions", httpStatus: 200, error: null, comboName: "daily-coder" }, "fallback");
}

function attemptEvents(trace, { host, format, t0, status, tokens, rand, chunks }) {
  const list = [
    { type: "route", direction: "internal", t_ms: t0, summary: `${trace.client_format} to ${format}`, payload: null },
    { type: "request", direction: "out", t_ms: t0 + 4, summary: `POST ${host}`, payload: { model: trace.model, stream: true, max_tokens: 8192, messages: `[redacted ${6 + Math.floor(rand() * 20)} messages]` } },
  ];
  if (status !== 200) return list;
  list.push({ type: "response", direction: "in", t_ms: t0 + (trace.ttft_ms || 400), summary: "200 OK", payload: { status: 200, headers: { "content-type": "text/event-stream" } } });
  const step = Math.max(20, Math.floor(((trace.total_ms || 2000) - (trace.ttft_ms || 400)) / (chunks + 1)));
  for (let index = 0; index < chunks; index += 1) {
    list.push({ type: "sse_chunk", direction: "out", t_ms: t0 + (trace.ttft_ms || 400) + step * (index + 1), summary: null, payload: chunkPayload(format, TEXT[index % TEXT.length]) });
  }
  list.push({ type: "info", direction: "internal", t_ms: trace.total_ms, summary: `usage · in ${tokens.prompt_tokens} · out ${tokens.completion_tokens}`, payload: tokens });
  return list;
}

/** Events for a stored trace row, in seq order. */
export function traceEvents(trace) {
  const rand = seeded(hashSeed(trace.id));
  const chunks = 4 + Math.floor(rand() * 6);
  let list;
  if (trace._kind === "fallback") {
    const first = LANES.find((lane) => lane.connectionId === "conn-claude-balin" && lane.model === "claude-sonnet-5");
    const retryAfter = 30 + Math.floor(rand() * 30);
    list = [
      { type: "route", direction: "internal", t_ms: 0, summary: "combo daily-coder: cc/claude-sonnet-5 → cx/gpt-6-astra → gh/gpt-5.4 → deepseek/deepseek-v4-pro", payload: { combo: "daily-coder", strategy: "fallback" } },
      { type: "attempt", direction: "internal", t_ms: 1, summary: `attempt 1 · cc/claude-sonnet-5 · ${first.accountName}`, payload: { attempt: 1, model: "cc/claude-sonnet-5", connectionId: first.connectionId } },
      ...attemptEvents({ ...trace, model: "claude-sonnet-5" }, { host: HOSTS.claude, format: "claude", t0: 2, status: 429, tokens: trace._tokens, rand, chunks }),
      { type: "response", direction: "in", t_ms: 310, summary: "429 Too Many Requests", payload: { status: 429, headers: { "retry-after": String(retryAfter), "anthropic-ratelimit-requests-remaining": "0" }, error: { type: "rate_limit_error", message: "Number of requests has exceeded your per-minute rate limit." } } },
      { type: "fallback", direction: "internal", t_ms: 312, summary: `cc/claude-sonnet-5 rate limited on ${first.accountName}; cooling down ${retryAfter}s, falling back to cx/gpt-6-astra`, payload: { from: "cc/claude-sonnet-5", to: "cx/gpt-6-astra", reason: "rate_limit", status: 429, cooldownMs: retryAfter * 1000, connectionId: first.connectionId } },
      { type: "attempt", direction: "internal", t_ms: 313, summary: "attempt 2 · cx/gpt-6-astra · balin@erebor.dev", payload: { attempt: 2, model: "cx/gpt-6-astra", connectionId: "conn-codex-main" } },
      ...attemptEvents(trace, { host: HOSTS.codex, format: "openai-responses", t0: 314, status: 200, tokens: trace._tokens, rand, chunks }),
    ];
  } else if (trace._kind === "error") {
    list = [
      ...attemptEvents(trace, { host: HOSTS[trace.provider], format: trace.provider_format, t0: 0, status: trace._httpStatus, tokens: trace._tokens, rand, chunks }),
      { type: "response", direction: "in", t_ms: trace.total_ms - 2, summary: `${trace._httpStatus}`, payload: { status: trace._httpStatus, error: { message: trace._error } } },
      { type: "error", direction: "internal", t_ms: trace.total_ms, summary: trace._error, payload: null },
    ];
  } else {
    list = attemptEvents(trace, { host: HOSTS[trace.provider] || "upstream", format: trace.provider_format, t0: 0, status: 200, tokens: trace._tokens, rand, chunks });
  }
  return list.map((item, index) => ({ id: index + 1, trace_id: trace.id, seq: index + 1, ...item }));
}

/** Seed rows: one trace per recent request plus a few daily-coder fallbacks. */
export function seedTraces(events) {
  const rows = events.map((event) => traceFromEvent(event));
  const fallbacks = events
    .filter((event, index) => index % 31 === 3 && event.httpStatus === 200)
    .slice(0, 6)
    .map((event, index) => fallbackFromEvent(
      { ...event, timestamp: new Date(new Date(event.timestamp).getTime() + MINUTE_MS / 2).toISOString() },
      index === 0 ? FALLBACK_TRACE_ID : `${event.traceId.slice(0, -4)}fb0${index}`,
    ));
  return [...fallbacks, ...rows].sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
}

export function publicTrace(row) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith("_")));
}

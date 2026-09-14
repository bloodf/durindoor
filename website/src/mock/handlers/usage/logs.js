// /api/usage/logs, /request-logs, /request-details and /providers, all read
// from the same raw request events the stats use.
import { badRequest, notFound } from "../../http.js";
import { LANES, providerDisplay } from "../../fixtures/usageLanes.js";
import { requestEvents } from "./live.js";

// Display names for the providers in the demo world (AI_PROVIDERS names).
const PROVIDER_NAMES = {
  claude: "Claude Code", anthropic: "Anthropic", codex: "OpenAI Codex", "gemini-cli": "Gemini CLI", github: "GitHub Copilot",
  antigravity: "Antigravity", kiro: "Kiro AI", cursor: "Cursor IDE", groq: "Groq", openrouter: "OpenRouter",
  deepseek: "DeepSeek", "ollama-local": "Ollama Local",
};

const pad = (value) => String(value).padStart(2, "0");

function logDate(iso) {
  const date = new Date(iso);
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function logLine(event) {
  const status = event.httpStatus === 200 ? "200 OK" : `FAILED ${event.httpStatus}`;
  const account = LANES[event.laneIndex].accountName;
  return `${logDate(event.timestamp)} | ${event.model} | ${event.provider.toUpperCase()} | ${account} | ${event.promptTokens} | ${event.completionTokens} | ${status}`;
}

function payloadMeta(bytes) {
  return bytes > 0 ? { redacted: true, version: 1, present: true, type: "object", bytes } : { redacted: true, version: 1, present: false, type: "none" };
}

function toDetail(event) {
  const failed = event.httpStatus !== 200;
  const requestBytes = 2_000 + event.promptTokens * 4;
  return {
    id: event.id,
    provider: event.provider,
    model: event.model,
    connectionId: event.connectionId,
    timestamp: event.timestamp,
    status: failed ? "error" : "success",
    latency: event.latency,
    tokens: event.tokens,
    request: payloadMeta(requestBytes),
    providerRequest: payloadMeta(requestBytes + 180),
    providerResponse: payloadMeta(failed ? 240 : 600 + event.completionTokens * 5),
    response: payloadMeta(failed ? 160 : 520 + event.completionTokens * 5),
  };
}

function toMs(value) {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export default function registerLogs(router, { store }) {
  const logs = () => requestEvents(store).slice(0, 200).map(logLine);
  router.get("/api/usage/logs", logs);
  router.get("/api/usage/request-logs", logs);

  router.get("/api/usage/request-details", ({ searchParams }) => {
    const all = requestEvents(store).map(toDetail);
    const id = searchParams.get("id");
    if (id) {
      const detail = all.find((item) => item.id === id);
      return detail ? { details: [detail], pagination: { page: 1, pageSize: 1, totalItems: 1, totalPages: 1, hasNext: false, hasPrev: false } } : notFound("Request detail not found");
    }
    const page = searchParams.get("page") === null ? 1 : Number(searchParams.get("page"));
    const pageSize = searchParams.get("pageSize") === null ? 20 : Number(searchParams.get("pageSize"));
    if (!Number.isInteger(page) || page < 1) return badRequest("page must be an integer >= 1");
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) return badRequest("pageSize must be an integer in [1,100]");
    const filters = ["provider", "model", "connectionId", "status"].map((key) => [key, searchParams.get(key)]).filter(([, value]) => value);
    const start = searchParams.get("startDate") ? toMs(searchParams.get("startDate")) : null;
    const end = searchParams.get("endDate") ? toMs(searchParams.get("endDate")) : null;
    const matching = all.filter((detail) => {
      const at = new Date(detail.timestamp).getTime();
      return filters.every(([key, value]) => detail[key] === value) && (start == null || at >= start) && (end == null || at <= end);
    });
    const totalItems = matching.length;
    const totalPages = Math.ceil(totalItems / pageSize);
    return {
      details: matching.slice((page - 1) * pageSize, page * pageSize),
      pagination: { page, pageSize, totalItems, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
    };
  });

  router.get("/api/usage/providers", () => {
    const ids = [...new Set(requestEvents(store).map((event) => event.provider))].sort();
    return { providers: ids.map((id) => ({ id, name: PROVIDER_NAMES[id] || providerDisplay(id) })) };
  });
}

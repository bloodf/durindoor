import { DefaultExecutor } from "./default.js";
import { resolveOllamaLocalHost } from "../config/providers.js";
import { OLLAMA_LOCAL_CONNECT_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { dbg } from "../utils/debugLog.js";

// Format byte count to human-readable string for debug logs
import { isString } from "../../src/shared/utils/typeChecks.js";function fmtBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(2)}MB`;
}

// Format ms duration to human-readable string for debug logs
function fmtMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Build a compact breakdown of a chat messages array for debug logs:
 * role counts, tool_call count, and rough content size.
 */
function summariseMessages(messages) {
  const msgs = messages || [];
  const roleCounts = {};
  let toolCalls = 0;
  let contentChars = 0;

  for (const m of msgs) {
    const role = m?.role || "other";
    roleCounts[role] = (roleCounts[role] || 0) + 1;
    if (Array.isArray(m?.tool_calls)) toolCalls += m.tool_calls.length;

    if (isString(m?.content)) {
      contentChars += m.content.length;
    } else if (Array.isArray(m?.content)) {
      for (const block of m.content) {
        if (isString(block?.text)) contentChars += block.text.length;else
        contentChars += JSON.stringify(block || "").length;
      }
    }
  }

  const roleStr = Object.entries(roleCounts).
  map(([role, count]) => `${role.slice(0, 3)}=${count}`).
  join(" ");

  const parts = [`${msgs.length} msgs [${roleStr}]`];
  if (toolCalls > 0) parts.push(`tool_calls=${toolCalls}`);
  parts.push(`~${fmtBytes(contentChars)} content`);
  return parts.join(" | ");
}

/**
 * Emit targeted hints when a large body is detected.
 * Breaks down where the size is coming from.
 */
function warnLargeBody(body, bodyBytes, host) {
  const msgs = body?.messages || [];
  const totalMsgs = msgs.length;

  // Find biggest messages (top 3)
  const withSize = msgs.
  map((m, i) => ({ i, role: m?.role, size: JSON.stringify(m).length })).
  sort((a, b) => b.size - a.size).
  slice(0, 3);

  const topStr = withSize.
  map((m) => `  msg[${m.i}] ${m.role} = ${fmtBytes(m.size)}`).
  join("\n");

  dbg("OLLAMA-LOCAL", [
  `⚠ Large body (${fmtBytes(bodyBytes)}) — breakdown:`,
  `  total_messages : ${totalMsgs}`,
  `  top offenders  :\n${topStr}`,
  `  tools          : ${body?.tools?.length ?? 0} defined`,
  `  max_tokens     : ${body?.max_tokens ?? "unset"}`,
  `Hints: trim old messages, reduce tool definitions, or set a lower max_tokens.`,
  `Ollama timeout raised to ${fmtMs(OLLAMA_LOCAL_CONNECT_TIMEOUT_MS)} — if it still fails,`,
  `consider setting OLLAMA_LOCAL_CONNECT_TIMEOUT_MS env var higher.`].
  join("\n    "));
}

export class OllamaLocalExecutor extends DefaultExecutor {
  constructor() {
    super("ollama-local");
    // Override connect timeout: local models (especially large ones) need more
    // time to load weights before returning response headers.
    this.config = {
      ...this.config,
      timeoutMs: OLLAMA_LOCAL_CONNECT_TIMEOUT_MS,
      // Disable network retry for local — no fallback host exists.
      // Retrying multiplies latency (3 × timeout) with zero benefit when Ollama is down.
      retry: {
        502: { attempts: 0, delayMs: 0 },
        503: { attempts: 0, delayMs: 0 },
        504: { attempts: 0, delayMs: 0 }
      }
    };
  }

  // Runtime transport-aware URL selection.
  // When the resolved transport is the Claude-native /v1/messages path, substitute
  // the configured local Ollama host while preserving the path/query/suffix from the
  // registry transport. Falls back to the Ollama OpenAI-compatible /api/chat endpoint.
  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const rt = credentials?.runtimeTransport;
    if (rt?.baseUrl) {
      // Preserve path + query + urlSuffix (parent contract), substitute the local host.
      // try/catch: malformed/relative/empty baseUrl falls back to verbatim like the parent
      // (default.js:122 uses rt.baseUrl as-is, never parses). WR-01/02/03.
      let url = rt.baseUrl;
      try {
        const u = new URL(rt.baseUrl);
        const configured = new URL(resolveOllamaLocalHost(credentials));
        // Stored local values may be origins or complete Ollama endpoints.
        // Runtime transport owns the endpoint path, so retain only the configured origin.
        url = configured.origin + u.pathname + u.search;
      } catch {
        url = rt.baseUrl;
      }
      if (rt.urlSuffix) url += rt.urlSuffix;
      return url;
    }
    return `${resolveOllamaLocalHost(credentials)}/api/chat`;
  }

  // Override execute: emit rich debug diagnostics then delegate to BaseExecutor.
  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const host = resolveOllamaLocalHost(credentials);
    const timeoutMs = this.config.timeoutMs;
    const t0 = Date.now();

    // ── Pre-flight diagnostics ──────────────────────────────────────────
    const bodyStr = JSON.stringify(body);
    const bodyBytes = bodyStr.length;
    const msgSummary = summariseMessages(body?.messages);

    dbg("OLLAMA-LOCAL", [
    `→ ${host}/api/chat`,
    `model=${model}`,
    `stream=${stream ?? "unset"}`,
    `body=${fmtBytes(bodyBytes)}`,
    `timeout=${fmtMs(timeoutMs)}`,
    `max_tokens=${body?.max_tokens ?? "unset"}`,
    `tools=${body?.tools?.length ?? 0}`].
    join(" | "));

    dbg("OLLAMA-LOCAL", `  messages: ${msgSummary}`);

    if (bodyBytes > 200 * 1024) {
      warnLargeBody(body, bodyBytes, host);
    }

    // ── Delegate ────────────────────────────────────────────────────────
    try {
      const result = await super.execute({ model, body, stream, credentials, signal, log, proxyOptions });
      const elapsed = Date.now() - t0;
      dbg("OLLAMA-LOCAL", `✓ connected in ${fmtMs(elapsed)} | url=${result.url}`);
      return result;
    } catch (error) {
      const elapsed = Date.now() - t0;
      const isTimeout =
      error.name === "AbortError" || error.message?.includes("fetch connect timeout");

      const lines = [
      `✖ ${error.name}: ${error.message}`,
      `  elapsed    : ${fmtMs(elapsed)} / timeout=${fmtMs(timeoutMs)}`,
      `  target     : ${host}/api/chat`,
      `  model      : ${model}`,
      `  body size  : ${fmtBytes(bodyBytes)}`];


      if (isTimeout) {
        lines.push(
          `  diagnosis  : Ollama did not return response headers within ${fmtMs(timeoutMs)}.`,
          `  candidates : model not loaded, Ollama not running, or body too large for available RAM.`,
          `  check      : curl -s ${host}/api/tags | jq '.models[].name'`,
          `  env fix    : OLLAMA_LOCAL_CONNECT_TIMEOUT_MS=${timeoutMs * 2} (current × 2)`
        );
      }

      dbg("OLLAMA-LOCAL", lines.join("\n    "));
      throw error;
    }
  }
}

export default OllamaLocalExecutor;
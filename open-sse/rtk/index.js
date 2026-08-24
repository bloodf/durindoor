// RTK port: compress tool_result content in LLM request bodies
// Injected at the top of translateRequest (before any format translation)
import { RAW_CAP, MIN_COMPRESS_SIZE } from "./constants.js";
import { autoDetectFilter } from "./autodetect.js";
import { safeApply } from "./applyFilter.js";
import { isFunction, isNumber, isObject, isString } from "../../src/shared/utils/typeChecks.js";

// Compress tool_result content in-place. Returns stats or null if disabled/failed.
export function compressMessages(body, enabled) {
  if (!enabled) return null;
  if (!body) return null;

  // Kiro format: conversationState.history + conversationState.currentMessage
  if (body.conversationState) {
    return compressKiroFormat(body, enabled);
  }

  // Support both OpenAI/Claude "messages" and OpenAI Responses "input"
  const items = Array.isArray(body.messages) ? body.messages :
  Array.isArray(body.input) ? body.input :
  null;
  if (!items) return null;

  const stats = { bytesBefore: 0, bytesAfter: 0, hits: [] };
  try {
    for (let i = 0; i < items.length; i++) {
      const msg = items[i];
      if (!msg) continue;

      // Shape 4: OpenAI Responses — top-level { type:"function_call_output", output: string | [{type:"input_text", text}] }
      if (msg.type === "function_call_output") {
        if (isString(msg.output)) {
          msg.output = compressText(msg.output, stats, "openai-responses-string");
        } else if (Array.isArray(msg.output)) {
          for (let k = 0; k < msg.output.length; k++) {
            const part = msg.output[k];
            if (part && part.type === "input_text" && isString(part.text)) {
              part.text = compressText(part.text, stats, "openai-responses-array");
            }
          }
        }
        continue;
      }

      // Shape 1: OpenAI tool message — { role:"tool", content: "string" }
      if (msg.role === "tool" && isString(msg.content)) {
        msg.content = compressText(msg.content, stats, "openai-tool");
        continue;
      }

      if (!Array.isArray(msg.content)) continue;

      // Shape 1b: OpenAI tool message — { role:"tool", content:[{type:"text", text:"..."}] }
      if (msg.role === "tool") {
        for (let k = 0; k < msg.content.length; k++) {
          const part = msg.content[k];
          if (part && part.type === "text" && isString(part.text)) {
            part.text = compressText(part.text, stats, "openai-tool-array");
          }
        }
        continue;
      }

      // Shape 2/3: blocks array with tool_result entries
      for (let j = 0; j < msg.content.length; j++) {
        const block = msg.content[j];
        if (!block || block.type !== "tool_result") continue;
        if (block.is_error === true) continue; // preserve error traces

        if (isString(block.content)) {
          // Shape 2: claude string form
          block.content = compressText(block.content, stats, "claude-string");
        } else if (Array.isArray(block.content)) {
          // Shape 3: claude array form — compress each text part
          for (let k = 0; k < block.content.length; k++) {
            const part = block.content[k];
            if (part && part.type === "text" && isString(part.text)) {
              part.text = compressText(part.text, stats, "claude-array");
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn("[RTK] compressMessages error:", e.message);
    return null;
  }
  return stats;
}

// Compress Kiro format: conversationState.history[].userInputMessage.userInputMessageContext.toolResults[].content[].text
function compressKiroFormat(body, enabled) {
  const stats = { bytesBefore: 0, bytesAfter: 0, hits: [] };
  try {
    const state = body.conversationState;
    const allMessages = [...(Array.isArray(state?.history) ? state.history : [])];
    if (state?.currentMessage) allMessages.push(state.currentMessage);

    for (const msg of allMessages) {
      const toolResults = msg?.userInputMessage?.userInputMessageContext?.toolResults;
      if (!Array.isArray(toolResults)) continue;

      for (const tr of toolResults) {
        if (tr.status === "error") continue; // preserve error traces
        if (!Array.isArray(tr.content)) continue;

        for (const part of tr.content) {
          if (part && isString(part.text)) {
            part.text = compressText(part.text, stats, "kiro-tool-result");
          }
        }
      }
    }
  } catch (e) {
    console.warn("[RTK] compressKiroFormat error:", e.message);
    return null;
  }
  return stats;
}

// UTF-8 byte length without Node's Buffer so shared open-sse code stays
// portable to Worker runtimes (Codex P2 on #306).
const utf8Encoder = new TextEncoder();
const utf8ByteLength = (s) => utf8Encoder.encode(s).length;

/**
 * Compress one tool_result text blob and record a hit labeled by request layout
 * (e.g. "openai-tool", "claude-string", "kiro-tool-result").
 * @param {string} text
 * @param {{ bytesBefore: number, bytesAfter: number, hits: object[] }} stats
 * @param {string} layout request-layout id for stats.hits[].layout
 */
function compressText(text, stats, layout) {
  // Measure UTF-8 content bytes, not UTF-16 code units, so non-ASCII tool
  // output is counted accurately. This is the content size, not provider
  // billing (providers bill tokens) nor full wire size (JSON escaping and HTTP
  // framing differ). The dashboard labels this "content bytes saved".
  const bytesIn = utf8ByteLength(text);
  stats.bytesBefore += bytesIn;

  if (text.length < MIN_COMPRESS_SIZE || bytesIn > RAW_CAP) {
    stats.bytesAfter += bytesIn;
    return text;
  }

  const fn = autoDetectFilter(text);
  if (!fn) {
    stats.bytesAfter += bytesIn;
    return text;
  }

  const out = safeApply(fn, text);

  // Safety: never return empty, never grow the input (compare on bytes)
  const bytesOut = out ? utf8ByteLength(out) : 0;
  if (!out || bytesOut === 0 || bytesOut >= bytesIn) {
    stats.bytesAfter += bytesIn;
    return text;
  }

  stats.bytesAfter += bytesOut;
  stats.hits.push({ layout, filter: fn.filterName || fn.name, saved: bytesIn - bytesOut });
  return out;
}

// Per-request token-saver bypass (port of decolua/9router#2609).
// `X-DurinDoor-Token-Saver: off` disables every token saver for one chat
// request; the legacy `X-9Router-Token-Saver` alias is honored for wire
// compatibility with 9router clients. The DurinDoor header takes precedence
// whenever present — even with an empty value — so a client can re-enable
// savers despite a legacy `off` injected upstream. Only the exact value
// `off` (case-insensitive) bypasses; any other value keeps savers enabled.
export const TOKEN_SAVER_PRIMARY_HEADER = "x-durindoor-token-saver";
export const TOKEN_SAVER_LEGACY_HEADER = "x-9router-token-saver";

function readHeaderValue(headers, name) {
  if (!headers) return undefined;
  // Fetch API Headers instance (case-insensitive by contract).
  if (isFunction(headers.get)) {
    const v = headers.get(name);
    return v === null || v === undefined ? undefined : String(v);
  }
  if (isObject(headers)) {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === name) {
        const v = headers[key];
        return v === null || v === undefined ? undefined : String(v);
      }
    }
  }
  return undefined;
}

export function resolveTokenSaverEnabled(headers) {
  const primary = readHeaderValue(headers, TOKEN_SAVER_PRIMARY_HEADER);
  const raw = primary !== undefined ? primary : readHeaderValue(headers, TOKEN_SAVER_LEGACY_HEADER);
  return raw === undefined || raw.toLowerCase() !== "off";
}

// Convenience: format a log line from stats
export function formatRtkLog(stats) {
  if (!stats || !stats.hits || stats.hits.length === 0) return null;
  const saved = stats.bytesBefore - stats.bytesAfter;
  const pct = stats.bytesBefore > 0 ? (saved / stats.bytesBefore * 100).toFixed(1) : "0";
  const filters = Array.from(new Set(stats.hits.map((h) => h.filter))).join(",");
  return `[RTK] saved ${saved}B / ${stats.bytesBefore}B (${pct}%) via [${filters}] hits=${stats.hits.length}`;
}

// ─── Aggregate Token Saver telemetry (pure) ────────────────────────────────
// Port of decolua/9router #2562 — aggregate Token Saver dashboard data with no
// double counting. These functions are pure: no I/O, no DB, no globals. The
// caller (chatCore) normalizes one event per logical request and persists it;
// the dashboard reads period aggregates. Separation keeps open-sse free of the
// src-layer DB while making the math unit-testable.

// Allowlisted Headroom skip categories. Raw diagnostic strings can carry URLs
// or upstream error text; persisting them as aggregate keys would leak that
// into the dashboard. Unknown values map to "other-skip" (matches upstream).
const SAFE_HEADROOM_DIAGNOSTICS = new Set([
"disabled",
"missing-proxy-url",
"timeout",
"http-error",
"unsafe-responses-input",
"translation-failed",
"unsupported-shape",
"invalid-proxy-response",
"unexpected-error",
"other-skip"]
);

function safeHeadroomDiagnostic(value) {
  if (!isString(value) || !value) return null;
  return SAFE_HEADROOM_DIAGNOSTICS.has(value) ? value : "other-skip";
}

function toNonNeg(v) {
  const n = isString(v) ? Number(v) : v;
  return isNumber(n) && Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Normalize one logical request's token-saver outcome into the pieces kept.
 * Each source contributes its OWN delta exactly once. Returns a canonical,
 * JSON-safe event; unknown/garbage fields coerce to 0 so a bad caller can
 * never poison the aggregate.
 *
 * Sources and their measures (never mix a source delta with the overall
 * pipeline delta — that would double count):
 *   rtk:       content bytes (UTF-8) removed from tool_result text.
 *   headroom:  reported token delta (tokensSaved) + actual body bytes.
 *   pxpipe:    estimated token delta (tokensSavedEst) — image billing model.
 * `totals.actualBytesSaved` is rtk.bytesSaved + max(0, headroom body bytes
 * shrink) only; pxpipe/compression stay separate estimates (not bytes).
 */
export function normalizeTokenSaverEvent(event) {
  const e = event && isObject(event) ? event : {};
  const rtk = e.rtk && isObject(e.rtk) ? e.rtk : {};
  const headroom = e.headroom && isObject(e.headroom) ? e.headroom : {};
  const pxpipe = e.pxpipe && isObject(e.pxpipe) ? e.pxpipe : {};

  const rtkBytesSaved = toNonNeg(rtk.bytesSaved);
  const hrState = ["compressed", "skipped", "disabled"].includes(headroom.state) ? headroom.state : "disabled";
  // Skip is observed, never saved: a non-compressed Headroom pass keeps its
  // state bucket and diagnostic, but its reported token/byte deltas are NOT
  // savings (the proxy declined to compress). Zero them so a malformed
  // positive-delta skip can never inflate the aggregate (upstream #2562
  // invariant: disabled/skipped never increases Headroom savings fields).
  const hrCompressed = hrState === "compressed";
  const hrBodyBefore = hrCompressed ? toNonNeg(headroom.bodyBytesBefore) : 0;
  const hrBodyAfter = hrCompressed ? toNonNeg(headroom.bodyBytesAfter) : 0;
  const hrBodyShrink = Math.max(0, hrBodyBefore - hrBodyAfter);

  return {
    requestsObserved: 1,
    rtk: {
      requestsWithHits: toNonNeg(rtk.requestsWithHits),
      hits: toNonNeg(rtk.hits),
      bytesBefore: toNonNeg(rtk.bytesBefore),
      bytesAfter: toNonNeg(rtk.bytesAfter),
      bytesSaved: rtkBytesSaved
    },
    headroom: {
      // "compressed" | "skipped" | "disabled"
      state: hrState,
      tokensBefore: hrCompressed ? toNonNeg(headroom.tokensBefore) : 0,
      tokensAfter: hrCompressed ? toNonNeg(headroom.tokensAfter) : 0,
      tokensSaved: hrCompressed ? toNonNeg(headroom.tokensSaved) : 0,
      bodyBytesBefore: hrBodyBefore,
      bodyBytesAfter: hrBodyAfter,
      phantomSavings: hrCompressed && headroom.phantomSavings ? 1 : 0,
      diagnostic: safeHeadroomDiagnostic(headroom.diagnostic)
    },
    pxpipe: {
      applied: pxpipe.applied ? 1 : 0,
      tokensBeforeEst: toNonNeg(pxpipe.tokensBeforeEst),
      tokensAfterEst: toNonNeg(pxpipe.tokensAfterEst),
      tokensSavedEst: toNonNeg(pxpipe.tokensSavedEst),
      imageCount: toNonNeg(pxpipe.imageCount)
    },
    totals: {
      actualBytesSaved: rtkBytesSaved + hrBodyShrink
    }
  };
}

function emptyTokenSaverAggregate() {
  return {
    requestsObserved: 0,
    rtk: { requestsWithHits: 0, hits: 0, bytesBefore: 0, bytesAfter: 0, bytesSaved: 0 },
    headroom: {
      compressed: 0, skipped: 0, disabled: 0,
      tokensBefore: 0, tokensAfter: 0, tokensSaved: 0,
      bodyBytesBefore: 0, bodyBytesAfter: 0,
      phantomSavings: 0, skipReasons: {}
    },
    pxpipe: { applied: 0, tokensBeforeEst: 0, tokensAfterEst: 0, tokensSavedEst: 0, imageCount: 0 },
    totals: { actualBytesSaved: 0 }
  };
}

/**
 * Fold a list of normalized per-request events into one period aggregate.
 * Empty input yields a zeroed aggregate. Headroom `state` buckets are counted
 * (compressed/skipped/disabled) but only real deltas are summed — a skip is
 * observed, never "saved". The caller is responsible for deduping retries
 * (one event per request id) before calling; this function sums what it gets.
 */
export function aggregateTokenSaverEvents(events) {
  const agg = emptyTokenSaverAggregate();
  if (!Array.isArray(events) || events.length === 0) return agg;

  for (const raw of events) {
    if (!raw || !isObject(raw)) continue;
    // Always normalize: never trust caller-supplied totals/keys. A malformed
    // event coerces to safe zeros instead of skewing the period sum. One row =
    // one logical request, so requestsObserved is always 1 — ignore any caller
    // count so a replayed/merged row can't inflate the request total.
    const e = normalizeTokenSaverEvent(raw);
    agg.requestsObserved += 1;

    agg.rtk.requestsWithHits += toNonNeg(e.rtk?.requestsWithHits);
    agg.rtk.hits += toNonNeg(e.rtk?.hits);
    agg.rtk.bytesBefore += toNonNeg(e.rtk?.bytesBefore);
    agg.rtk.bytesAfter += toNonNeg(e.rtk?.bytesAfter);
    agg.rtk.bytesSaved += toNonNeg(e.rtk?.bytesSaved);

    const state = e.headroom?.state;
    if (state === "compressed") agg.headroom.compressed += 1;else
    if (state === "skipped") agg.headroom.skipped += 1;else
    agg.headroom.disabled += 1;
    agg.headroom.tokensBefore += toNonNeg(e.headroom?.tokensBefore);
    agg.headroom.tokensAfter += toNonNeg(e.headroom?.tokensAfter);
    agg.headroom.tokensSaved += toNonNeg(e.headroom?.tokensSaved);
    agg.headroom.bodyBytesBefore += toNonNeg(e.headroom?.bodyBytesBefore);
    agg.headroom.bodyBytesAfter += toNonNeg(e.headroom?.bodyBytesAfter);
    agg.headroom.phantomSavings += toNonNeg(e.headroom?.phantomSavings);
    if (state === "skipped") {
      const reason = isString(e.headroom?.diagnostic) && e.headroom.diagnostic ? e.headroom.diagnostic : "other-skip";
      agg.headroom.skipReasons[reason] = (agg.headroom.skipReasons[reason] || 0) + 1;
    }

    agg.pxpipe.applied += toNonNeg(e.pxpipe?.applied);
    agg.pxpipe.tokensBeforeEst += toNonNeg(e.pxpipe?.tokensBeforeEst);
    agg.pxpipe.tokensAfterEst += toNonNeg(e.pxpipe?.tokensAfterEst);
    agg.pxpipe.tokensSavedEst += toNonNeg(e.pxpipe?.tokensSavedEst);
    agg.pxpipe.imageCount += toNonNeg(e.pxpipe?.imageCount);

    agg.totals.actualBytesSaved += toNonNeg(e.totals?.actualBytesSaved);
  }
  return agg;
}
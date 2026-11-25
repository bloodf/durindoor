/**
 * Bounded SSE prefix peek shared by the combo loop and the single-model
 * early-EOF sibling failover (src/sse/handlers/chat.js).
 *
 * The peek reads the client-facing stream until the first frame that carries
 * output. Every consumed byte is kept so the caller can replay it unchanged
 * ahead of the unread live body. Nothing reaches the client during the peek,
 * which is what makes a retry on another connection safe: a stream that ends
 * or errors before any content has sent the client nothing.
 */
import { STREAM_FIRST_CHUNK_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { isString } from "../../src/shared/utils/typeChecks.js";
import { extractStreamErrorPayload } from "./streamLifecycle.js";
import { isSafetyStopPayload } from "./safetyStopFrame.js";
import { createNoticeGate } from "./unavailableNotice.js";

const SSE_CONTENT_TYPE = "text/event-stream";
export const STREAM_PEEK_MAX_BYTES = 256 * 1024;
/**
 * With releaseOnProgress, the longest the peek holds a stream after the first
 * lifecycle event while waiting for a content verdict. Empty turns that end
 * inside this window are still reported as empty (OmniRoute #21207).
 */
export const PEEK_PROGRESS_GRACE_MS = 1000;

// Preserve raw terminal evidence across response wrappers and prefix replay.
const tokenLimitEvidence = new WeakMap();

export function trackStreamTokenLimit(body, hasTokenLimitTerminal) {
  tokenLimitEvidence.set(body, hasTokenLimitTerminal);
}

export function inheritStreamTokenLimit(source, target) {
  const evidence = tokenLimitEvidence.get(source);
  if (evidence) tokenLimitEvidence.set(target, evidence);
}

function nonEmptyString(value) {
  return isString(value) && value.length > 0;
}

export function frameCarriesContent(line) {
  if (!line.startsWith("data:")) return false;
  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") return false;

  let parsed;
  try {parsed = JSON.parse(payload);} catch {return false;}


  const delta = parsed.choices?.[0]?.delta;
  if (
  nonEmptyString(delta?.content) ||
  nonEmptyString(delta?.reasoning_content) ||
  nonEmptyString(delta?.reasoning) ||
  delta?.tool_calls?.length > 0 ||
  delta?.function_call)
  return true;

  if (parsed.type === "content_block_delta") {
    const content = parsed.delta;
    if (
    nonEmptyString(content?.text) ||
    nonEmptyString(content?.partial_json) ||
    nonEmptyString(content?.thinking))
    return true;
  }
  if (parsed.type === "content_block_start" && parsed.content_block?.type === "tool_use") return true;

  if (isString(parsed.type) && parsed.type.endsWith(".delta") && nonEmptyString(parsed.delta)) return true;

  // Responses reasoning may arrive only in a completed summary or item.
  if (parsed.type === "response.reasoning_summary_text.done" && nonEmptyString(parsed.text)) return true;
  if ((parsed.type === "response.output_item.added" || parsed.type === "response.output_item.done") &&
      parsed.item?.type === "reasoning" && Array.isArray(parsed.item.summary) &&
      parsed.item.summary.some((part) => nonEmptyString(part?.text))) return true;

  /** Antigravity wraps native Gemini stream members in a response envelope. */
  const geminiResponse = parsed.response || parsed;
  const parts = geminiResponse.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts) && parts.some((part) =>
  nonEmptyString(part?.text) || part?.functionCall || part?.inlineData))
  return true;

  return nonEmptyString(parsed.message?.content) ||
  nonEmptyString(parsed.response) ||
  parsed.message?.tool_calls?.length > 0;
}

const LIFECYCLE_EVENT_TYPES = new Set(["message_start", "content_block_start", "response.created", "response.in_progress"]);
const SILENT_DELTA_TYPES = new Set(["thinking_delta", "signature_delta", "input_json_delta"]);

/** True for an event that shows the upstream started a turn, even with no output yet. */
function isLifecycleProgress(parsed) {
  if (LIFECYCLE_EVENT_TYPES.has(parsed?.type)) return true;
  if (parsed?.type === "content_block_delta") return SILENT_DELTA_TYPES.has(parsed.delta?.type);
  return nonEmptyString(parsed?.choices?.[0]?.delta?.role);
}

function parseDataLine(line) {
  if (!line.startsWith("data:")) return null;
  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") return null;
  try {return JSON.parse(payload);} catch {return null;}
}

/**
 * Replay buffered chunks, then either finish (upstream done), re-raise the
 * upstream error, or keep reading the live reader.
 */
function replayStream(reader, chunks, { done = false, error = null, pendingRead = null } = {}) {
  let index = 0;
  // A read left in flight by a peek timeout must be consumed first, or its
  // chunk would be lost behind the next read.
  pendingRead?.catch(() => {});
  let finished = false;
  const release = () => {try {reader.releaseLock();} catch {}};

  return new ReadableStream({
    async pull(controller) {
      if (finished) return;
      if (index < chunks.length) {
        controller.enqueue(chunks[index++]);
        return;
      }
      if (error) {
        finished = true;
        release();
        controller.error(error);
        return;
      }
      if (done) {
        finished = true;
        release();
        controller.close();
        return;
      }
      try {
        const next = await (pendingRead || reader.read());
        pendingRead = null;
        if (next.done) {
          finished = true;
          release();
          controller.close();
        } else controller.enqueue(next.value);
      } catch (readError) {
        finished = true;
        release();
        controller.error(readError);
      }
    },
    async cancel(reason) {
      if (finished) return;
      finished = true;
      try {await reader.cancel(reason);} catch {} finally {release();}
    }
  });
}

/**
 * Inspect a bounded SSE prefix for output. Non-SSE bodies are never locked or
 * read. The body returned always replays what was consumed; a caller that
 * drops the attempt must cancel it.
 *
 * outcome:
 * - "content": a frame carried text, reasoning, or a tool call
 * - "safety_stop": an explicit provider safety/refusal stop arrived before any
 *   content. It is the provider's terminal answer, so it counts as a response:
 *   never an empty stream, never a reason for a sibling model or account
 * - "limit": the peek budget filled up without a verdict (treated as content)
 * - "empty": the stream closed before any content
 * - "error": the stream errored before any content
 * - "timeout": nothing yet within timeoutMs; body continues the live stream
 * - "unavailable_notice": only with detectUnavailableNotice; the visible text is
 *   a model/client-unavailable notice (`notice` holds it, hasContent is false).
 *   Text that could still become one is held until it diverges or the stream
 *   stops, and then counts as content.
 *
 * With releaseOnProgress, "progress" means a lifecycle event arrived and no
 * verdict followed within PEEK_PROGRESS_GRACE_MS (long silent thinking or tool
 * planning). It counts as content; body continues the live stream.
 *
 * streamError is the first in-stream error envelope seen before content.
 *
 * @param {Response} response
 * @param {number} [timeoutMs]
 * @param {{detectUnavailableNotice?: boolean, releaseOnProgress?: boolean}} [options]
 * @returns {Promise<{hasContent:boolean, outcome:string, body:ReadableStream|null,
 *   streamError: {type?: string, code?: string, message?: string}|null}>}
 */
export async function peekStreamForContent(response, timeoutMs = STREAM_FIRST_CHUNK_TIMEOUT_MS, { detectUnavailableNotice = false, releaseOnProgress = false } = {}) {
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes(SSE_CONTENT_TYPE) || !response.body) {
    return { hasContent: true, outcome: "content", body: null, streamError: null };
  }

  const hasTokenLimitTerminal = tokenLimitEvidence.get(response.body);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let bytes = 0;
  let pending = "";
  let streamError = null;
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
  });
  const gate = detectUnavailableNotice ? createNoticeGate() : null;
  let notice = null;
  const result = (verdict, replay = {}) => {
    // Held text is real output when the stream stops before it becomes a notice.
    let outcome = verdict;
    if (notice) outcome = "unavailable_notice";else
    if (gate?.holding && ["empty", "error", "timeout"].includes(verdict)) outcome = "content";
    const body = replayStream(reader, chunks, replay);
    if (hasTokenLimitTerminal) trackStreamTokenLimit(body, hasTokenLimitTerminal);
    return {
      hasContent: outcome === "content" || outcome === "limit" || outcome === "safety_stop" || outcome === "progress",
      outcome,
      body,
      streamError,
      ...(notice ? { notice } : null)
    };
  };
  let safetyStop = false;
  let sawProgress = false;
  let graceTimer;
  let grace = null;
  // True when the line carries output or an explicit safety stop; records the
  // first error envelope otherwise.
  const inspect = (line) => {
    if (frameCarriesContent(line)) {
      const frame = gate ? parseDataLine(line) : null;
      if (!frame) return true;
      const decision = gate.push(frame);
      if (decision === "notice") notice = gate.text;
      return decision !== "hold";
    }
    const parsed = parseDataLine(line);
    if (isSafetyStopPayload(parsed)) {
      safetyStop = true;
      return true;
    }
    if (!streamError) streamError = extractStreamErrorPayload(parsed);
    if (releaseOnProgress && !sawProgress) sawProgress = isLifecycleProgress(parsed);
    return false;
  };

  try {
    // Kept across iterations: a read that outlives the grace window stays pending.
    let read = null;
    while (bytes < STREAM_PEEK_MAX_BYTES) {
      read ||= reader.read();
      const next = await Promise.race(grace ? [read, timeout, grace] : [read, timeout]);
      if (next?.timedOut) return result("timeout", { pendingRead: read });
      if (next?.graceElapsed) {
        // An error or a possible unavailable notice keeps the peek in charge.
        if (!streamError && !gate?.holding) return result("progress", { pendingRead: read });
        grace = null;
        continue;
      }
      read = null;
      if (next.done) {
        pending += decoder.decode();
        const tail = pending.trim();
        if (tail && inspect(tail)) return result(safetyStop ? "safety_stop" : "content", { done: true });
        return result(!streamError && hasTokenLimitTerminal?.() ? "content" : "empty", { done: true });
      }

      chunks.push(next.value);
      bytes += next.value.byteLength;
      pending += decoder.decode(next.value, { stream: true });
      let newline;
      while ((newline = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, newline).trim();
        pending = pending.slice(newline + 1);
        if (inspect(line)) return result(safetyStop ? "safety_stop" : "content");
      }
      if (!streamError && hasTokenLimitTerminal?.()) return result("content");
      if (sawProgress && !graceTimer) {
        grace = new Promise((resolve) => {
          graceTimer = setTimeout(() => resolve({ graceElapsed: true }), PEEK_PROGRESS_GRACE_MS);
        });
      }
    }
    return result("limit");
  } catch (error) {
    return result("error", { error });
  } finally {
    clearTimeout(timer);
    clearTimeout(graceTimer);
  }
}

// Playground Compare: run one prompt against 2-4 models side by side.
//
// Pure helpers shared by the Compare panel and its tests. Behavior mirrors
// OmniRoute's Compare tab (docs/frameworks/PLAYGROUND_STUDIO.md, PRs #13317 /
// #13532 at diegosouzapw/OmniRoute@61e07fb7, MIT) on top of this playground's
// own SSE parser. Every request is user-triggered; nothing runs on load.

import { createSseParser } from "./sse.js";
import { sanitizeErrorText } from "./errors.js";
import { isObject, isString } from "../../shared/utils/typeChecks.js";

export const MIN_COMPARE_COLUMNS = 2;
export const MAX_COMPARE_COLUMNS = 4;
// ponytail: fixed cap; make it a setting if operators ask for more fan-out.
export const MAX_PARALLEL_COMPARE_RUNS = 2;

function textValue(value) {
  if (isString(value)) return value;
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join(" ");
  if (value && isObject(value) && isString(value.text)) return value.text;
  return "";
}

/** Text carried by one Chat Completions stream chunk (or a non-stream body). */
export function readAssistantText(chunk) {
  if (!chunk || !isObject(chunk)) return "";
  const choice = chunk.choices?.[0];
  const delta = choice?.delta || {};
  return [delta.content, choice?.message?.content, chunk.output_text, chunk.text].map(textValue).find(Boolean) || "";
}

export const EMPTY_STREAM_MESSAGE = "The stream ended without any content.";
export const STREAM_FAILED_MESSAGE = "The stream reported an error.";

/**
 * Reads a failure carried INSIDE a streamed response. A turn that fails after
 * the route has committed to `200 text/event-stream` cannot change its HTTP
 * status, so the gateway sends the error body as an ordinary `data:` frame.
 * Shapes: Chat Completions `{ error: { message } | "text" }`, Responses
 * `{ type: "error", message, error }` and `{ type: "response.failed",
 * response: { error } }`. Returns null for every ordinary frame, and
 * `{ message: null }` for a failure that carries no usable text.
 * @returns {{ message: string|null }|null}
 */
export function readStreamError(chunk) {
  if (!chunk || !isObject(chunk) || Array.isArray(chunk)) return null;
  const text = (value) => (isString(value) && value.trim() ? value : null);
  const messageOf = (value) => (value && isObject(value) ? text(value.message) : text(value));
  if (chunk.type === "response.failed") return { message: messageOf(chunk.response?.error) };
  if (chunk.type === "error") return { message: messageOf(chunk.error) ?? text(chunk.message) };
  if (chunk.error !== undefined && chunk.error !== null && chunk.error !== "") return { message: messageOf(chunk.error) };
  return null;
}

/**
 * Drains a Chat Completions SSE reader. Keeps the first in-band error frame
 * instead of dropping it, so callers can report it once the stream ends.
 * @returns {Promise<{text: string, usage: object|null, ttftMs: number|null, streamError: {message: string|null}|null}>}
 */
export async function readChatStream(reader, { onText, now = () => performance.now(), started = now() } = {}) {
  let text = "";
  let usage = null;
  let ttftMs = null;
  let streamError = null;
  const parser = createSseParser(({ data }) => {
    let chunk;
    try {
      chunk = JSON.parse(data);
    } catch {
      return;
    }
    streamError ??= readStreamError(chunk);
    if (chunk?.usage && isObject(chunk.usage)) usage = chunk.usage;
    const piece = readAssistantText(chunk);
    if (!piece) return;
    if (ttftMs === null) ttftMs = now() - started;
    text += piece;
    onText?.(text);
  });
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(decoder.decode());
  parser.flush();
  return { text, usage, ttftMs, streamError };
}

/** Never end a turn silently: an in-band error or a contentless stream becomes an Error. */
export function throwIfStreamFailed({ text, streamError }) {
  if (streamError) throw new Error(sanitizeErrorText(streamError.message) || STREAM_FAILED_MESSAGE);
  if (!text) throw new Error(EMPTY_STREAM_MESSAGE);
}

function abortError() {
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

/**
 * Promise limiter: at most `max` tasks run at once, the rest wait in FIFO order.
 * @param {number} max
 * @returns {(task: () => Promise<any>) => Promise<any>}
 */
export function createLimiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || queue.length === 0) return;
    active++;
    const { task, resolve, reject } = queue.shift();
    Promise.resolve().then(task).then(resolve, reject).finally(() => {
      active--;
      next();
    });
  };
  return (task) => new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    next();
  });
}

/**
 * Stream one chat completion. Latency is measured from dispatch (not queue
 * entry); TTFT is the first text chunk. Throws AbortError when cancelled and a
 * sanitized Error on HTTP failure.
 * @returns {Promise<{text: string, usage: object|null, latencyMs: number, ttftMs: number|null}>}
 */
export async function streamCompletion({ fetchImpl = globalThis.fetch, body, headers = {}, signal, onText, now = () => performance.now() }) {
  if (signal?.aborted) throw abortError();
  const started = now();
  const response = await fetchImpl("/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...headers },
    body: JSON.stringify({ ...body, stream: true, stream_options: { include_usage: true } }),
    signal
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(sanitizeErrorText(data.error || data.message) || `Request failed (${response.status})`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const data = await response.json().catch(() => ({}));
    return { text: readAssistantText(data), usage: data.usage ?? null, latencyMs: now() - started, ttftMs: null };
  }
  const { text, usage, ttftMs, streamError } = await readChatStream(reader, { onText, now, started });
  throwIfStreamFailed({ text, streamError });
  return { text, usage, latencyMs: now() - started, ttftMs };
}

const COMPARE_SELECTIONS_KEY = "durindoor.playground.compare.selections.v1";

/** Session-only selectors, never prompt/response content or request status.
 * Stored IDs are untrusted preferences: the panel rechecks them against the
 * current model catalog and connection options before dispatch.
 */
export function readCompareSelections(storage) {
  try {
    const saved = JSON.parse((storage || globalThis.sessionStorage).getItem(COMPARE_SELECTIONS_KEY));
    if (!Array.isArray(saved) || saved.length < MIN_COMPARE_COLUMNS || saved.length > MAX_COMPARE_COLUMNS) return null;
    if (!saved.every((item) => item && isString(item.modelId) && isString(item.connectionId))) return null;
    return saved.map(({ modelId, connectionId }) => ({ modelId, connectionId }));
  } catch {
    return null;
  }
}

export function writeCompareSelections(columns, storage) {
  try {
    (storage || globalThis.sessionStorage).setItem(COMPARE_SELECTIONS_KEY, JSON.stringify(
      columns.map(({ modelId = "", connectionId = "auto" }) => ({ modelId, connectionId }))
    ));
  } catch {
    // Storage may be unavailable or full; comparison still works in memory.
  }
}

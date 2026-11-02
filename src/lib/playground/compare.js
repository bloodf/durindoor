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

  let text = "";
  let usage = null;
  let ttftMs = null;
  const reader = response.body?.getReader();
  if (!reader) {
    const data = await response.json().catch(() => ({}));
    return { text: readAssistantText(data), usage: data.usage ?? null, latencyMs: now() - started, ttftMs: null };
  }
  const parser = createSseParser(({ data }) => {
    let chunk;
    try {
      chunk = JSON.parse(data);
    } catch {
      return;
    }
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
  return { text, usage, latencyMs: now() - started, ttftMs };
}

/**
 * Per-million rates for a compare model from the /api/pricing map, or null.
 * requestModel is "<provider>/<model>"; pricing is keyed provider -> model.
 */
export function findModelPricing(pricing, providerId, requestModel) {
  if (!pricing || !isObject(pricing) || !providerId || !requestModel) return null;
  const modelId = requestModel.startsWith(`${providerId}/`) ? requestModel.slice(providerId.length + 1) : requestModel;
  const rates = pricing[providerId]?.[modelId];
  return rates && isObject(rates) ? rates : null;
}

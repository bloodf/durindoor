// In-flight reservations against an API key's lifetime token cap
// (`policy.maxTokens`), ported from decolua/9router #2833.
//
// The lifetime cap is otherwise checked against committed usage only, so
// concurrent chat requests admitted while the key still had room could all
// run and overshoot it. A chat request now reserves its estimated input plus
// its (capped) output allowance for each requested choice before dispatch. The reservation is released
// when the response finishes, is cancelled or fails, after which committed
// usage in apiKeyUsageTotals carries the real count.
//
// - Atomic: the committed total is read synchronously and the reservation is
//   recorded in the same synchronous step, so no other request can interleave
//   between the check and the reservation inside this process.
// - Crash recovery: reservations are process memory. A crash drops them, and
//   committed usage is the only durable state, so nothing has to be repaired.
// - A lease bounds a reservation whose response body is never consumed.
// - Reservations are scoped by the key's stable id, never by its secret.
import { getAdapterSync } from "@/lib/db/driver.js";
import { validateApiKeyPolicy } from "@/lib/db/helpers/apiKeyPolicy.js";
import { FORMATS } from "open-sse/translator/formats.js";
import { isRecord, isString } from "@/shared/utils/typeChecks.js";

export const RESERVATION_LEASE_MS = 30 * 60 * 1000;
const CHARS_PER_TOKEN = 4;

if (!global._apiKeyTokenReservations) {
  global._apiKeyTokenReservations = { byKey: new Map(), byRequest: new WeakMap() };
}
const state = global._apiKeyTokenReservations;

function liveReservations(apiKeyId, now = Date.now()) {
  const entries = state.byKey.get(apiKeyId);
  if (!entries) return [];
  for (const entry of entries) {
    if (entry.expiresAt <= now) entries.delete(entry);
  }
  if (entries.size === 0) state.byKey.delete(apiKeyId);
  return [...entries];
}

/** Tokens currently reserved for a key, optionally excluding one request's own reservation. */
export function getReservedTokens(apiKeyId, { exclude = null, now = Date.now() } = {}) {
  if (!apiKeyId) return 0;
  const own = exclude ? state.byRequest.get(exclude) : null;
  return liveReservations(apiKeyId, now).reduce((sum, entry) => (entry === own ? sum : sum + entry.tokens), 0);
}

function readCommittedTokens(apiKeyId) {
  try {
    const row = getAdapterSync().get(`SELECT totalTokens FROM apiKeyUsageTotals WHERE apiKeyId = ?`, [apiKeyId]);
    return Number(row?.totalTokens) || 0;
  } catch (error) {
    if (/no such table:\s*apiKeyUsageTotals/i.test(String(error?.message || error))) return 0;
    throw error;
  }
}

const INLINE_MEDIA_PART_TOKENS = 1000;
const DEFAULT_OUTPUT_TOKENS = 8192;
// Base64 alphabet only, so prose behind a `data:` prefix is still measured.
const DATA_URL = /^data:[^,]*;base64,[A-Za-z0-9+/_=\r\n-]*$/i;
const RAW_BASE64 = /^[A-Za-z0-9+/_=\r\n-]+$/;
const MEDIA_URL_KEYS = new Set(["url", "image_url", "audio_url", "video_url", "image", "fileUri", "file_data"]);
const MEDIA_OBJECT_KEYS = new Set(["input_audio", "inlineData", "inline_data"]);

const isBase64Payload = (value) => isString(value) && (DATA_URL.test(value) || RAW_BASE64.test(value));

/**
 * Rough prompt-size estimate, the same heuristic upstream uses. Inline binary
 * parts count a fixed amount each instead of their base64 length.
 */
export function estimateInputTokens(body) {
  let mediaParts = 0;
  const stripMedia = (key, value) => {
    if (isRecord(value) && (MEDIA_OBJECT_KEYS.has(key) || value.type === "base64") && isBase64Payload(value.data)) {
      mediaParts += 1;
      return { ...value, data: "" };
    }
    const inlineUrl = MEDIA_URL_KEYS.has(key) && isString(value) && DATA_URL.test(value);
    if (inlineUrl || (key === "file_data" && isBase64Payload(value))) {
      mediaParts += 1;
      return "";
    }
    return value;
  };
  const source = body?.messages ?? body?.input ?? body?.prompt ?? body?.contents ?? "";
  const extras = [
    body?.system, body?.instructions, body?.systemInstruction, body?.tools, body?.functions,
    body?.request?.contents, body?.request?.systemInstruction, body?.request?.tools,
  ].filter((part) => part != null);
  const length = [source, ...extras].reduce((sum, part) => sum + JSON.stringify(part, stripMedia).length, 0);
  return Math.max(1, Math.ceil(length / CHARS_PER_TOKEN) + mediaParts * INLINE_MEDIA_PART_TOKENS);
}

// Every spelling of the output limit that a translator or passthrough may send.
const OUTPUT_PATHS = {
  maxTokens: ["max_tokens"],
  maxCompletionTokens: ["max_completion_tokens"],
  maxOutputTokens: ["max_output_tokens"],
  gemini: ["generationConfig", "maxOutputTokens"],
  antigravity: ["request", "generationConfig", "maxOutputTokens"],
};

/**
 * The fields the request's own format reads. A limit found only elsewhere may be
 * dropped in translation, so the first of these must always end up populated.
 */
function nativeOutputPaths(body, sourceFormat) {
  if (sourceFormat === FORMATS.OPENAI_RESPONSES) return [OUTPUT_PATHS.maxOutputTokens];
  if (sourceFormat === FORMATS.CLAUDE) return [OUTPUT_PATHS.maxTokens];
  const chat = [OUTPUT_PATHS.maxTokens, OUTPUT_PATHS.maxCompletionTokens];
  if (Array.isArray(body?.messages)) return chat;
  if (body?.input !== undefined) return [OUTPUT_PATHS.maxOutputTokens];
  if (body?.request?.contents !== undefined) return [OUTPUT_PATHS.antigravity];
  if (body?.contents !== undefined) return [OUTPUT_PATHS.gemini];
  return chat;
}

const readPath = (body, path) => path.reduce((node, field) => node?.[field], body);

/** Copy of `body` with `path` set to `value`; `undefined` removes the field. */
function writePath(body, [field, ...rest], value) {
  const copy = { ...body };
  if (rest.length) copy[field] = writePath(copy[field], rest, value);
  else if (value === undefined) delete copy[field];
  else copy[field] = value;
  return copy;
}

function tokenCount(value) {
  const count = Math.floor(Number(value));
  return Number.isFinite(count) && count > 0 ? count : 0;
}

/**
 * Cap every populated output field to `perChoice` and make sure the request's
 * own format carries a limit.
 *
 * @returns {{ body: object, outputTokens: number }} `outputTokens` is the
 *   largest limit left on the body, for one choice.
 */
function capOutputFields(body, perChoice, { modelMaxOutput, sourceFormat }) {
  let capped = body;
  let outputTokens = 0;
  const populated = new Set();
  for (const path of Object.values(OUTPUT_PATHS)) {
    const raw = readPath(body, path);
    if (raw === undefined) continue;
    // An unusable value (null, 0, -1) is removed: it could outrank a real limit
    // downstream or mean "unlimited" upstream.
    const value = Math.min(tokenCount(raw), perChoice) || undefined;
    if (value !== raw) capped = writePath(capped, path, value);
    if (value === undefined) continue;
    populated.add(path);
    outputTokens = Math.max(outputTokens, value);
  }
  const native = nativeOutputPaths(body, sourceFormat);
  if (!native.some((path) => populated.has(path))) {
    outputTokens ||= Math.min(perChoice, tokenCount(modelMaxOutput) || DEFAULT_OUTPUT_TOKENS);
    capped = writePath(capped, native[0], outputTokens);
  }
  return { body: capped, outputTokens };
}

/**
 * Reserve lifetime tokens for one chat request.
 *
 * @param {Request} request The request that owns the reservation.
 * @param {object|null} keyRecord Admitted API key record.
 * @param {object} body Request body.
 * @param {number} [now]
 * @param {{ modelMaxOutput?: number, sourceFormat?: string }} [context] The
 *   requested model's output ceiling, when known, and the client wire format.
 * @returns {{ ok: true, body: object, tokens: number } | { ok: false, used: number, limit: number }}
 *   `body` has its output allowance capped to the remaining quota.
 */
export function reserveLifetimeTokens(request, keyRecord, body, now = Date.now(), context = {}) {
  if (!keyRecord?.id) return { ok: true, body, tokens: 0 };
  const policy = validateApiKeyPolicy(keyRecord.policy);
  const limit = policy.ok && policy.value?.maxTokens != null ? Number(policy.value.maxTokens) : null;
  if (limit == null || !Number.isFinite(limit)) return { ok: true, body, tokens: 0 };

  const used = readCommittedTokens(keyRecord.id) + getReservedTokens(keyRecord.id, { now });
  const inputTokens = estimateInputTokens(body);
  // Each of the `n` choices may use the full output limit.
  const choices = tokenCount(body?.n) || 1;
  const perChoice = Math.floor((limit - used - inputTokens) / choices);
  if (perChoice < 1) return { ok: false, used, limit };

  const { body: cappedBody, outputTokens } = capOutputFields(body, perChoice, context);

  const entry = { tokens: inputTokens + outputTokens * choices, expiresAt: now + RESERVATION_LEASE_MS, apiKeyId: keyRecord.id };
  if (!state.byKey.has(keyRecord.id)) state.byKey.set(keyRecord.id, new Set());
  state.byKey.get(keyRecord.id).add(entry);
  if (request) state.byRequest.set(request, entry);
  return { ok: true, body: cappedBody, tokens: entry.tokens };
}

/** Release a request's reservation. Idempotent. */
export function releaseLifetimeTokens(request) {
  const entry = request ? state.byRequest.get(request) : null;
  if (!entry) return;
  state.byRequest.delete(request);
  const entries = state.byKey.get(entry.apiKeyId);
  if (!entries) return;
  entries.delete(entry);
  if (entries.size === 0) state.byKey.delete(entry.apiKeyId);
}

/**
 * Hold a request's reservation until its response is complete.
 *
 * An error, an empty body or a thrown handler releases at once. A successful
 * body releases when the client reads it to the end, cancels it, or it errors.
 */
export function holdReservationForResponse(request, response) {
  if (!request || !state.byRequest.has(request)) return response;
  if (!(response instanceof Response) || !response.body || response.status < 200 || response.status >= 300) {
    releaseLifetimeTokens(request);
    return response;
  }
  const reader = response.body.getReader();
  const release = () => releaseLifetimeTokens(request);
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          release();
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        release();
        controller.error(error);
      }
    },
    async cancel(reason) {
      release();
      await reader.cancel(reason);
    },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

/** Test helper. */
export function __resetLifetimeTokenReservationsForTests() {
  state.byKey.clear();
  state.byRequest = new WeakMap();
}

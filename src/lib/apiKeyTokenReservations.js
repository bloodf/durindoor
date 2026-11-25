// In-flight reservations against an API key's lifetime token cap
// (`policy.maxTokens`), ported from decolua/9router #2833.
//
// The lifetime cap is otherwise checked against committed usage only, so
// concurrent chat requests admitted while the key still had room could all
// run and overshoot it. A chat request now reserves its estimated input plus
// its (capped) output allowance before dispatch. The reservation is released
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

/** Rough prompt-size estimate, the same heuristic upstream uses. */
export function estimateInputTokens(body) {
  const source = body?.messages ?? body?.input ?? body?.prompt ?? body?.contents ?? "";
  const text = JSON.stringify(source) + JSON.stringify(body?.system ?? "");
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

const OUTPUT_FIELDS = ["max_completion_tokens", "max_output_tokens", "max_tokens"];

function requestedOutputTokens(body) {
  for (const field of OUTPUT_FIELDS) {
    const value = Number(body?.[field]);
    if (body?.[field] != null && Number.isFinite(value) && value > 0) return { field, value: Math.floor(value) };
  }
  return null;
}

function defaultOutputField(body) {
  if (!Array.isArray(body?.messages) && body?.input !== undefined) return "max_output_tokens";
  return "max_tokens";
}

/**
 * Reserve lifetime tokens for one chat request.
 *
 * @param {Request} request The request that owns the reservation.
 * @param {object|null} keyRecord Admitted API key record.
 * @param {object} body Request body.
 * @returns {{ ok: true, body: object, tokens: number } | { ok: false, used: number, limit: number }}
 *   `body` has its output allowance capped to the remaining quota.
 */
export function reserveLifetimeTokens(request, keyRecord, body, now = Date.now()) {
  if (!keyRecord?.id) return { ok: true, body, tokens: 0 };
  const policy = validateApiKeyPolicy(keyRecord.policy);
  const limit = policy.ok && policy.value?.maxTokens != null ? Number(policy.value.maxTokens) : null;
  if (limit == null || !Number.isFinite(limit)) return { ok: true, body, tokens: 0 };

  const used = readCommittedTokens(keyRecord.id) + getReservedTokens(keyRecord.id, { now });
  const remaining = limit - used;
  const inputTokens = estimateInputTokens(body);
  if (remaining <= inputTokens) return { ok: false, used, limit };

  const room = remaining - inputTokens;
  const requested = requestedOutputTokens(body);
  const outputTokens = requested ? Math.min(requested.value, room) : room;
  const field = requested?.field ?? defaultOutputField(body);
  const cappedBody = requested && requested.value <= room ? body : { ...body, [field]: outputTokens };

  const entry = { tokens: inputTokens + outputTokens, expiresAt: now + RESERVATION_LEASE_MS, apiKeyId: keyRecord.id };
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

/**
 * Auth header, deadlines and bounded reads for the staged ElevenLabs music adapter.
 * Upstream bodies never leave this module except as bytes or parsed JSON for the
 * caller to validate; error bodies only yield the ElevenLabs `detail.status` slug.
 */
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";

const STATUS_SLUG = /^[a-z][a-z0-9_]{0,63}$/;

const trimmed = (value) => (isString(value) && value.trim() ? value.trim() : null);

/**
 * Source handleElevenLabsMusicGeneration: `credentials.apiKey || credentials.accessToken`,
 * always sent as `xi-api-key`. Returns `{ mode, headers }` or `null`.
 */
export function buildElevenLabsMusicAuth(credentials) {
  const apiKey = trimmed(credentials?.apiKey);
  const accessToken = apiKey ? null : trimmed(credentials?.accessToken);
  const secret = apiKey || accessToken;
  if (!secret) return null;
  return { mode: apiKey ? "api_key" : "access_token", headers: { "Content-Type": "application/json", "xi-api-key": secret } };
}

export function stopError(kind, signal) {
  const error = new Error(kind === "abort" ? "Request aborted" : "ElevenLabs music deadline exceeded");
  error.kind = kind;
  if (kind === "abort" && signal?.reason) error.cause = signal.reason;
  return error;
}

/** Reject as soon as `overall` aborts, even when the wrapped promise ignores signals. */
export function raceStop(promise, overall, callerSignal) {
  const kind = () => (callerSignal?.aborted ? "abort" : "deadline");
  if (overall.aborted) return Promise.reject(stopError(kind(), callerSignal));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(stopError(kind(), callerSignal));
    overall.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => overall.removeEventListener("abort", onAbort));
  });
}

/** Read at most `maxBytes` as a Buffer; cancels the stream on overflow or abort. */
export async function readBoundedBytes(response, maxBytes, overall, callerSignal) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const buffer = Buffer.from(await raceStop(Promise.resolve(response.arrayBuffer()), overall, callerSignal));
    return buffer.length > maxBytes ? { tooLarge: true } : { buffer };
  }
  const chunks = [];
  let total = 0;
  const onAbort = () => { void reader.cancel("elevenlabs music read stopped").catch(() => {}); };
  overall.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      const { done, value } = await raceStop(reader.read(), overall, callerSignal);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        void reader.cancel("elevenlabs music body too large").catch(() => {});
        return { tooLarge: true };
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    overall.removeEventListener("abort", onAbort);
  }
  return { buffer: Buffer.concat(chunks) };
}

/** ElevenLabs `detail.status` slug (e.g. ` quota_exceeded`) or "", never the message. */
export function elevenLabsStatusLabel(buffer) {
  try {
    const detail = JSON.parse(buffer.toString("utf8"))?.detail;
    const status = isRecord(detail) ? detail.status : null;
    return isString(status) && STATUS_SLUG.test(status) ? ` ${status}` : "";
  } catch {
    return "";
  }
}

export function retryAfterMs(response, now) {
  const raw = response.headers?.get?.("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return now() + Math.min(seconds, 3600) * 1000;
  const date = Date.parse(raw);
  return Number.isFinite(date) ? date : undefined;
}

export const clampMs = (value, fallback, max) => (Number.isFinite(value) && value > 0 ? Math.min(value, max) : fallback);

export function discardBody(response) {
  void response?.body?.cancel?.().catch(() => {});
}

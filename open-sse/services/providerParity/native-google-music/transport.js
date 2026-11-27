/**
 * Auth headers, deadlines and bounded reads shared by the staged Gemini Lyria
 * generate and discovery calls. Upstream bodies never leave this module except
 * as parsed JSON for the caller to validate; error bodies only yield the
 * enumerated Google `error.status` label.
 */
import { isString } from "../../../../src/shared/utils/typeChecks.js";

const GOOGLE_STATUS = /^[A-Z_]{1,40}$/;

const trimmed = (value) => (isString(value) && value.trim() ? value.trim() : null);

/**
 * Source buildGeminiMusicHeaders: an API key wins and goes in `x-goog-api-key`;
 * otherwise an OAuth access token goes in `Authorization: Bearer`. Returns
 * `{ mode, headers }` or `null` when the selected connection has neither.
 */
export function buildGeminiMusicAuth(credentials) {
  const apiKey = trimmed(credentials?.apiKey);
  if (apiKey) return { mode: "api_key", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey } };
  const accessToken = trimmed(credentials?.accessToken);
  if (accessToken) return { mode: "oauth", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` } };
  return null;
}

export function stopError(kind, signal) {
  const error = new Error(kind === "abort" ? "Request aborted" : "Gemini Lyria deadline exceeded");
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

/** Read at most `maxBytes`; cancels the stream on overflow or abort. */
export async function readBounded(response, maxBytes, overall, callerSignal) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await raceStop(Promise.resolve(response.text()), overall, callerSignal);
    return Buffer.byteLength(text) > maxBytes ? { tooLarge: true } : { text };
  }
  const chunks = [];
  let total = 0;
  const onAbort = () => { void reader.cancel("gemini music read stopped").catch(() => {}); };
  overall.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      const { done, value } = await raceStop(reader.read(), overall, callerSignal);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        void reader.cancel("gemini music body too large").catch(() => {});
        return { tooLarge: true };
      }
      chunks.push(value);
    }
  } finally {
    overall.removeEventListener("abort", onAbort);
  }
  return { text: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8") };
}

/** Google `error.status` enum (e.g. ` RESOURCE_EXHAUSTED`) or "", never the message. */
export function googleStatusLabel(text) {
  try {
    const status = JSON.parse(text)?.error?.status;
    return isString(status) && GOOGLE_STATUS.test(status) ? ` ${status}` : "";
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

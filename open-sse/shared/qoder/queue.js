/**
 * Qoder model-queue handling (ported from upstream 9router 2720cd2a, trimmed).
 *
 * When a model is temporarily out of capacity Qoder answers the inference
 * request with a `{statusCodeValue, body}` SSE envelope whose body carries
 * `{ "code": "10605", "message": "{\"isQueued\":true,...,\"retryAfterSeconds\":30}",
 * "subCode": "RESOURCE_LIMIT" }`. That is a transient capacity signal, not a
 * billing block: the same request succeeds once the queue drains.
 *
 * The payload is frequently double-encoded, so lookups walk nested objects and
 * JSON-encoded string fields.
 *
 * Unverified: shapes come from upstream's commit text; no live Qoder capture.
 */

import { isNumber, isObject, isString } from "../../../src/shared/utils/typeChecks.js";

export const QODER_QUEUE_CODE = "10605";
export const QODER_MODEL_QUEUE_MAX_WAIT_ENV = "QODER_MODEL_QUEUE_MAX_WAIT_MS";

// A gateway must not hold a client request for long: 3 minutes covers several of
// Qoder's ~30s windows, then a retryable 503 is returned.
const DEFAULT_MAX_WAIT_MS = 180_000;
// Hard cap on replays, independent of the wait budget.
export const QODER_QUEUE_MAX_ATTEMPTS = 6;
const DEFAULT_RETRY_MS = 30_000;
// Qoder has answered retryAfterSeconds:2 while still refusing; replaying that fast
// makes the throttle worse, so the floor is a full retry interval.
const MIN_RETRY_MS = 15_000;
const MAX_RETRY_MS = 60_000;

const NESTED_KEYS = ["error", "data", "body", "message", "cause", "result", "payload"];

const isPlainObject = (v) => isObject(v) && !Array.isArray(v);

function toNumber(v) {
  if (isNumber(v) && Number.isFinite(v)) return v;
  if (isString(v) && /^-?\d+(?:\.\d+)?$/.test(v.trim())) return Number(v.trim());
  return undefined;
}

function toText(v) {
  return isString(v) && v.trim() ? v.trim() : undefined;
}

function toBool(v) {
  if (v === true || v === "true") return true;
  if (v === false || v === "false") return false;
  return undefined;
}

function tryParse(value) {
  if (!isString(value)) return undefined;
  const s = value.trim();
  if (!s || (s[0] !== "{" && s[0] !== "[")) return undefined;
  try {
    const parsed = JSON.parse(s);
    return isPlainObject(parsed) || Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Breadth-first walk over nested objects and JSON-encoded string fields. */
function walkObjects(root) {
  const out = [];
  const seenObjects = new Set();
  const seenStrings = new Set();
  const queue = [root];
  while (queue.length > 0) {
    const node = queue.shift();
    if (isPlainObject(node)) {
      if (seenObjects.has(node)) continue;
      seenObjects.add(node);
      out.push(node);
      for (const key of NESTED_KEYS) {
        const v = node[key];
        if (isPlainObject(v) || Array.isArray(v)) {
          queue.push(v);
        } else if (isString(v) && !seenStrings.has(v)) {
          seenStrings.add(v);
          const parsed = tryParse(v);
          if (parsed) queue.push(parsed);
        }
      }
    } else if (Array.isArray(node)) {
      for (const item of node) {
        if (isPlainObject(item) || Array.isArray(item)) queue.push(item);
      }
    }
  }
  return out;
}

/**
 * Parse a payload into a queue descriptor, or null when it carries no queue
 * signal. A bare `code: "10605"` counts because the code alone is the signal.
 */
export function parseQoderQueueInfo(input) {
  const root = isString(input) ? tryParse(input) : input;
  if (!root) return null;

  const info = {};
  for (const obj of walkObjects(root)) {
    info.code ??= toText(obj.code);
    info.subCode ??= toText(obj.subCode);
    info.isQueued ??= toBool(obj.isQueued);
    info.modelKey ??= toText(obj.modelKey);
    info.queueType ??= toText(obj.queueType);
    info.queueCount ??= toNumber(obj.queueCount);
    info.serviceAvailable ??= toBool(obj.serviceAvailable);
    info.retryAfterSeconds ??= toNumber(obj.retryAfterSeconds);
    info.waitTime ??= toNumber(obj.waitTime);
  }

  const queued = info.isQueued === true || info.serviceAvailable === false ||
    info.subCode === "RESOURCE_LIMIT" || info.code === QODER_QUEUE_CODE;
  return queued ? info : null;
}

/** Delay before the next replay: the server hint clamped into MIN..MAX. */
export function computeQoderQueueDelayMs(info) {
  const hint = toNumber(info?.retryAfterSeconds) ?? toNumber(info?.waitTime);
  const ms = hint === undefined ? DEFAULT_RETRY_MS : hint * 1000;
  return Math.min(MAX_RETRY_MS, Math.max(MIN_RETRY_MS, ms));
}

/** Total budget for holding a request open while its model is queued. */
export function qoderQueueMaxWaitMs() {
  const raw = Number(process.env[QODER_MODEL_QUEUE_MAX_WAIT_ENV]);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_WAIT_MS;
}

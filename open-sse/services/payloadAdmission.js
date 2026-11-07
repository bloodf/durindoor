/**
 * Process-local bounded admission for request payload bytes and held SSE streams.
 *
 * Prevents memory exhaustion and latency spikes caused by large request bodies and
 * concurrent long-lived streaming connections (SSE).
 *
 * Ports OmniRoute payload-aware admission and pressure shedding (issue #1106,
 * OmniRoute #13762, #14457, #14566).
 *
 * Enforces four bounds:
 * 1. Byte budget: Maximum active payload bytes in-flight process-wide.
 * 2. Held streams: Maximum concurrent long-lived SSE / streaming connections.
 * 3. Queue depth: Maximum waiters allowed before shedding load immediately (503).
 * 4. Wait time: Maximum wait timeout before rejecting (503).
 *
 * The caller owns response completion; leases also release on abort.
 */

import { isNumber } from "../../src/shared/utils/typeChecks.js";

/**
 * Rejection reason codes.
 */
export const ADMISSION_REJECTION_REASONS = Object.freeze({
  QUEUE_FULL: "QUEUE_FULL",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  HELD_STREAMS_EXCEEDED: "HELD_STREAMS_EXCEEDED",
  TIMEOUT: "TIMEOUT",
  ABORTED: "ABORTED",
});

/**
 * Error thrown when payload admission rejects a request.
 */
export class PayloadAdmissionError extends Error {
  /**
   * @param {string} reason - Value from ADMISSION_REJECTION_REASONS
   * @param {string} message - Diagnostic message
   * @param {number} [status=503] - Suggested HTTP status code
   * @param {Object} [metadata={}] - Additional details
   */
  constructor(reason, message, status = 503, metadata = {}) {
    super(message);
    this.name = "PayloadAdmissionError";
    this.reason = reason;
    this.status = status;
    this.metadata = metadata;
  }
}

/**
 * Default process-wide byte budget: 64 MB.
 * Env override: MAX_PAYLOAD_ADMISSION_BYTES
 */
const DEFAULT_MAX_PAYLOAD_BYTES = (() => {
  const v = parseInt(process.env.MAX_PAYLOAD_ADMISSION_BYTES, 10);
  return Number.isFinite(v) && v > 0 ? v : 64 * 1024 * 1024;
})();

/**
 * Default maximum single request payload: 16 MB.
 * Env override: MAX_SINGLE_PAYLOAD_BYTES
 */
const DEFAULT_MAX_SINGLE_PAYLOAD_BYTES = (() => {
  const v = parseInt(process.env.MAX_SINGLE_PAYLOAD_BYTES, 10);
  return Number.isFinite(v) && v > 0 ? v : 16 * 1024 * 1024;
})();

/**
 * Default maximum concurrent held streams: 100.
 * Env override: MAX_HELD_STREAMS
 */
const DEFAULT_MAX_HELD_STREAMS = (() => {
  const v = parseInt(process.env.MAX_HELD_STREAMS, 10);
  return Number.isFinite(v) && v > 0 ? v : 100;
})();

/**
 * Default maximum queue depth: 50 requests.
 * Env override: MAX_ADMISSION_QUEUE_DEPTH
 */
const DEFAULT_MAX_QUEUE_DEPTH = (() => {
  const v = parseInt(process.env.MAX_ADMISSION_QUEUE_DEPTH, 10);
  return Number.isFinite(v) && v > 0 ? v : 50;
})();

/**
 * Default maximum queue wait time: 120 000 ms.
 * Env override: CONCURRENCY_GATE_TIMEOUT_MS
 */
const DEFAULT_TIMEOUT_MS = (() => {
  const v = parseInt(process.env.CONCURRENCY_GATE_TIMEOUT_MS, 10);
  return Number.isFinite(v) && v > 0 ? v : 120_000;
})();

/**
 * Global shared admission state (survives module reloads).
 * @type {{activeBytes: number, activeStreams: number, activeRequests: number, queue: Array<any>}}
 */
const admissionState = globalThis.__durindoorPayloadAdmission ??= {
  activeBytes: 0,
  activeStreams: 0,
  activeRequests: 0,
  queue: [],
};

/**
 * Fast estimation of request payload size in bytes.
 *
 * Handles string bodies, Buffers/typed arrays, pre-calculated numbers,
 * or JSON-compatible objects without deep unbounded recursion.
 *
 * @param {unknown} body
 * @returns {number} Byte length
 */
export function estimatePayloadBytes(body) {
  if (body == null) return 0;
  if (typeof body === "number" && Number.isFinite(body)) {
    return Math.max(0, Math.floor(body));
  }
  if (typeof body === "string") {
    return Buffer.byteLength(body, "utf8");
  }
  if (Buffer.isBuffer(body)) {
    return body.length;
  }
  if (ArrayBuffer.isView(body)) {
    return body.byteLength;
  }
  try {
    const serialized = JSON.stringify(body);
    return serialized ? Buffer.byteLength(serialized, "utf8") : 0;
  } catch {
    throw new PayloadAdmissionError(ADMISSION_REJECTION_REASONS.PAYLOAD_TOO_LARGE, "Cannot measure request payload", 413);
  }
}

/**
 * Try to admit waiters from the FIFO queue whose resource requirements fit.
 *
 * @param {Object} state
 * @param {Object} limits
 */
function drainQueue(state) {

  const i = 0;
  while (i < state.queue.length) {
    const entry = state.queue[i];
    const limits = entry.limits;
    const maxBytes = limits.maxPayloadBytes;
    const maxStreams = limits.maxHeldStreams;

    // Check if this waiter can fit into current capacity
    const fitsBytes = state.activeBytes + entry.bytes <= maxBytes;
    const fitsStreams = !entry.isStream || state.activeStreams + 1 <= maxStreams;

    if (fitsBytes && fitsStreams) {
      // Dequeue waiter
      state.queue.splice(i, 1);
      clearTimeout(entry.timer);
      entry.onAbort && entry.signal?.removeEventListener?.("abort", entry.onAbort);

      // Allocate
      state.activeBytes += entry.bytes;
      if (entry.isStream) state.activeStreams++;
      state.activeRequests++;

      // Create lease and resolve
      const lease = createLease({
        bytes: entry.bytes,
        isStream: entry.isStream,
        state,
        limits,
        signal: entry.signal,
      });
      entry.resolve(lease);
    } else {
      break;
    }
  }
}

/**
 * Creates an idempotent lease that safely decrements allocated capacity exactly once.
 *
 * @param {{bytes: number, isStream: boolean, state: Object, limits: Object, signal: AbortSignal|null}} param0
 * @returns {{release: () => void, released: boolean, bytes: number, isStream: boolean}}
 */
function createLease({ bytes, isStream, state, signal }) {
  let released = false;
  let detachAbort = null;

  const release = () => {
    if (released) return;
    released = true;
    if (detachAbort) {
      detachAbort();
      detachAbort = null;
    }
    state.activeBytes = Math.max(0, state.activeBytes - bytes);
    if (isStream) {
      state.activeStreams = Math.max(0, state.activeStreams - 1);
    }
    state.activeRequests = Math.max(0, state.activeRequests - 1);
    drainQueue(state);
  };

  // Immediate pending cancellation protection: if signal fires while lease is held,
  // release immediately (handles upstream hung handler or disconnect before body consumption).
  if (signal) {
    if (signal.aborted) {
      release();
    } else {
      const onPendingAbort = () => release();
      signal.addEventListener("abort", onPendingAbort, { once: true });
      detachAbort = () => signal.removeEventListener("abort", onPendingAbort);
    }
  }

  return {
    release,
    get released() {
      return released;
    },
    bytes,
    isStream,
  };
}

/**
 * Acquire payload and held-stream admission.
 *
 * @param {Object} options
 * @param {unknown} [options.body] - Request body (object, string, buffer) or size in bytes
 * @param {number} [options.payloadBytes] - Explicit pre-calculated byte size
 * @param {boolean} [options.stream=false] - Whether this request is a long-lived held SSE stream
 * @param {number} [options.timeoutMs] - Maximum queue wait time (ms)
 * @param {AbortSignal|null} [options.signal=null] - AbortSignal for cancellation
 * @param {Object} [options.limits] - Custom limits override
 * @param {number} [options.limits.maxPayloadBytes]
 * @param {number} [options.limits.maxSinglePayloadBytes]
 * @param {number} [options.limits.maxHeldStreams]
 * @param {number} [options.limits.maxQueueDepth]
 * @returns {Promise<{release: () => void, released: boolean, bytes: number, isStream: boolean}>}
 */
export function acquirePayloadAdmission(options = {}) {
  const {
    body,
    payloadBytes,
    stream = false,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal = null,
    limits = {},
  } = options;

  if (signal?.aborted) {
    return Promise.reject(new DOMException("Admission wait aborted", "AbortError"));
  }

  const maxPayloadBytes = isNumber(limits.maxPayloadBytes) && limits.maxPayloadBytes > 0
    ? limits.maxPayloadBytes
    : DEFAULT_MAX_PAYLOAD_BYTES;

  const maxSingleBytes = isNumber(limits.maxSinglePayloadBytes) && limits.maxSinglePayloadBytes > 0
    ? limits.maxSinglePayloadBytes
    : DEFAULT_MAX_SINGLE_PAYLOAD_BYTES;

  const maxHeldStreams = isNumber(limits.maxHeldStreams) && limits.maxHeldStreams > 0
    ? limits.maxHeldStreams
    : DEFAULT_MAX_HELD_STREAMS;

  const maxQueueDepth = isNumber(limits.maxQueueDepth) && limits.maxQueueDepth >= 0
    ? limits.maxQueueDepth
    : DEFAULT_MAX_QUEUE_DEPTH;

  const resolvedLimits = {
    maxPayloadBytes,
    maxSinglePayloadBytes: maxSingleBytes,
    maxHeldStreams,
    maxQueueDepth,
  };

  const bytes = Number.isFinite(payloadBytes)
    ? Math.max(0, Math.floor(payloadBytes))
    : estimatePayloadBytes(body);

  const isStream = Boolean(stream);

  // Check 1: Single request exceeds maximum allowed single payload size
  if (bytes > maxSingleBytes) {
    return Promise.reject(
      new PayloadAdmissionError(
        ADMISSION_REJECTION_REASONS.PAYLOAD_TOO_LARGE,
        `Request payload size (${bytes} bytes) exceeds maximum single payload limit of ${maxSingleBytes} bytes`,
        413,
        { bytes, maxSingleBytes }
      )
    );
  }

  // Check 2: Request payload exceeds total system byte budget
  if (bytes > maxPayloadBytes) {
    return Promise.reject(
      new PayloadAdmissionError(
        ADMISSION_REJECTION_REASONS.PAYLOAD_TOO_LARGE,
        `Request payload size (${bytes} bytes) exceeds total admission byte budget of ${maxPayloadBytes} bytes`,
        413,
        { bytes, maxPayloadBytes }
      )
    );
  }

  const state = admissionState;

  // Fast path: queue is empty and capacity is available
  const canFitBytes = state.activeBytes + bytes <= maxPayloadBytes;
  const canFitStream = !isStream || state.activeStreams + 1 <= maxHeldStreams;

  if (state.queue.length === 0 && canFitBytes && canFitStream) {
    state.activeBytes += bytes;
    if (isStream) state.activeStreams++;
    state.activeRequests++;

    const lease = createLease({
      bytes,
      isStream,
      state,
      limits: resolvedLimits,
      signal,
    });
    return Promise.resolve(lease);
  }

  // Slow path: check queue depth for pressure shedding
  if (state.queue.length >= maxQueueDepth) {
    const error = new PayloadAdmissionError(
      ADMISSION_REJECTION_REASONS.QUEUE_FULL,
      `Admission queue depth limit reached (${state.queue.length}/${maxQueueDepth}); request shed due to high pressure`,
      503,
      { currentQueued: state.queue.length, maxQueueDepth }
    );
    return Promise.reject(error);
  }

  // Queue and wait
  return new Promise((resolve, reject) => {
    const entry = {
      resolve,
      reject,
      bytes,
      isStream,
      timer: null,
      signal,
      onAbort: null,
      limits: resolvedLimits,
    };

    const cleanup = () => {
      clearTimeout(entry.timer);
      signal?.removeEventListener?.("abort", entry.onAbort);
    };

    entry.timer = setTimeout(() => {
      const idx = state.queue.indexOf(entry);
      if (idx !== -1) state.queue.splice(idx, 1);
      cleanup();
      drainQueue(state);
      reject(
        new PayloadAdmissionError(
          ADMISSION_REJECTION_REASONS.TIMEOUT,
          `Admission timed out after ${timeoutMs}ms waiting for capacity (${bytes} bytes, stream=${isStream})`,
          503,
          { timeoutMs, bytes, isStream }
        )
      );
    }, timeoutMs);

    entry.timer.unref?.();

    entry.onAbort = () => {
      const idx = state.queue.indexOf(entry);
      if (idx !== -1) state.queue.splice(idx, 1);
      cleanup();
      drainQueue(state);
      reject(new DOMException("Admission wait aborted", "AbortError"));
    };

    state.queue.push(entry);
    signal?.addEventListener?.("abort", entry.onAbort, { once: true });
    if (signal?.aborted) entry.onAbort();
  });
}

/**
 * Get current payload admission statistics.
 *
 * @returns {{activeBytes: number, activeStreams: number, activeRequests: number, queuedRequests: number}}
 */
export function getPayloadAdmissionStats() {
  return {
    activeBytes: admissionState.activeBytes,
    activeStreams: admissionState.activeStreams,
    activeRequests: admissionState.activeRequests,
    queuedRequests: admissionState.queue.length,
  };
}

/**
 * Reset payload admission state (for testing).
 */
export function resetPayloadAdmission() {
  for (const entry of admissionState.queue) {
    clearTimeout(entry.timer);
    entry.onAbort && entry.signal?.removeEventListener?.("abort", entry.onAbort);
    entry.reject(new Error("Payload admission reset"));
  }
  admissionState.queue = [];
  admissionState.activeBytes = 0;
  admissionState.activeStreams = 0;
  admissionState.activeRequests = 0;
}

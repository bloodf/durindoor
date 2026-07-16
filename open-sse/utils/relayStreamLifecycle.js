/**
 * Relay SSE lifecycle helper (port of diegosouzapw/OmniRoute#7093
 * "fix(relay): bound Bifrost stream lifetime").
 *
 * Upstream bug: the relay fetch timeout was cleared when response headers
 * arrived, so a stalled SSE stream could run indefinitely and bypass the
 * cooldown/fallback path. `boundRelayStreamLifetime` keeps the caller's
 * timeout/abort signal live until the body actually ends: normal EOF, stream
 * error, downstream cancel, or caller abort — whichever first. Finalization
 * runs exactly once and always removes the abort listener so an unconsumed
 * body cannot leak the listener or timer.
 */

/** True when a relayed upstream response is an SSE stream. */
export function isRelaySseResponse(response) {
  const contentType = response?.headers?.get?.("content-type") || "";
  return Boolean(response?.body) && contentType.toLowerCase().includes("text/event-stream");
}

/**
 * Wrap a relayed upstream body so `onFinalize(error?)` fires exactly once when
 * the stream lifetime ends, and so an external `signal` abort cancels the
 * upstream reader immediately (not only on the next pending pull).
 *
 * @param {ReadableStream<Uint8Array>} body upstream response body
 * @param {object} [options]
 * @param {AbortSignal} [options.signal] caller timeout/abort signal kept live
 *   until the body finalizes; aborting cancels the reader and finalizes.
 * @param {(error?: unknown) => void} [options.onFinalize] runs exactly once:
 *   `undefined` on clean EOF, the error on stream error, the reason on cancel
 *   or abort.
 * @returns {ReadableStream<Uint8Array>}
 */
export function boundRelayStreamLifetime(body, { signal = null, onFinalize = null } = {}) {
  const reader = body.getReader();
  let finalized = false;
  let downstream = null;

  const finalizeOnce = (error) => {
    if (finalized) return;
    finalized = true;
    if (signal) signal.removeEventListener("abort", onAbort);
    onFinalize?.(error);
  };

  // Signal-driven termination is a caller abort/timeout: always surface it
  // downstream as AbortError (never a clean EOF, never a plain Error name),
  // preserving the reason as the cause for diagnostics.
  const abortError = (reason) => {
    const message = reason instanceof Error ? reason.message : "Aborted";
    const error = new DOMException(message || "Aborted", "AbortError");
    if (reason != null) error.cause = reason;
    return error;
  };

  const onAbort = () => {
    // Cancel immediately even when no pull() is pending; reader.cancel also
    // resolves any in-flight read() as done, so pull() must check finalized.
    const error = abortError(signal.reason);
    reader.cancel(error).catch(() => {});
    finalizeOnce(error);
    // Surface the abort downstream as an error, never as a clean EOF close.
    try { downstream?.error(error); } catch { /* already closed */ }
  };

  if (signal) {
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      // Already aborted before wrapping: cancel upstream, run the same finalize path.
      const error = abortError(signal.reason);
      reader.cancel(error).catch(() => {});
      finalizeOnce(error);
      return new ReadableStream({
        start(controller) {
          controller.error(error);
        },
      });
    }
  }

  return new ReadableStream({
    start(controller) {
      downstream = controller;
    },
    async pull(controller) {
      if (finalized) return;
      try {
        const { done, value } = await reader.read();
        if (finalized) return;
        if (done) {
          finalizeOnce();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        if (finalized) return;
        finalizeOnce(error);
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        finalizeOnce(reason);
      }
    },
  });
}

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

/**
 * The canonical relay/connect timeout abort reason. Using a DOMException named
 * "TimeoutError" lets the stream-lifecycle wrapper distinguish internal
 * timeouts from caller aborts without changing pre-header fetch behavior.
 */
export function fetchConnectTimeoutError() {
  return new DOMException("fetch connect timeout", "TimeoutError");
}

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
 * @param {AbortSignal} [options.timeoutSignal] the internal relay/connect
 *   timeout controller's signal. Only when THIS signal aborted with the exact
 *   reason now on `signal` is the reason preserved verbatim (provenance by
 *   identity, not name): a caller `AbortSignal.timeout()` supplies a
 *   TimeoutError too, and that must still normalize to AbortError.
 * @param {(error?: unknown) => void} [options.onFinalize] runs exactly once:
 *   `undefined` on clean EOF, the error on stream error, the reason on cancel
 *   or abort.
 * @returns {ReadableStream<Uint8Array>}
 */
export function boundRelayStreamLifetime(body, { signal = null, timeoutSignal = null, onFinalize = null } = {}) {
  const reader = body.getReader();
  let finalized = false;
  let downstream = null;

  const finalizeOnce = (error) => {
    if (finalized) return;
    finalized = true;
    if (signal) signal.removeEventListener("abort", onAbort);
    onFinalize?.(error);
  };

  // Signal-driven termination surfaces downstream as an error, never as a
  // clean EOF. Preserve the internal relay/connect timeout reason verbatim —
  // wrapping it as AbortError would let createDisconnectAwareStream's catch
  // treat a relay timeout after partial SSE bytes as a graceful network
  // close. Provenance is by IDENTITY (timeoutSignal aborted with this exact
  // reason object), never by name: a caller AbortSignal.timeout() reason is
  // also named TimeoutError and must normalize to AbortError like every
  // other caller abort.
  const abortError = (reason) => {
    if (timeoutSignal && timeoutSignal.aborted && timeoutSignal.reason === reason) return reason;
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

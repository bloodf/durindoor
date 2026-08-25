// Stream handler with disconnect detection - shared for all providers
import { STREAM_STALL_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { dbg, isDebugEnabled } from "./debugLog.js";
import { sanitizeErrorMessage } from "./error.js";

// Get HH:MM:SS timestamp
import { isString } from "../../src/shared/utils/typeChecks.js";
function getTimeString() {
  return new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * Create stream controller with abort and disconnect detection
 * @param {object} options
 * @param {AbortSignal} options.externalSignal - Client signal forwarded into stream lifecycle cleanup
 * @param {function} options.onDisconnect - Callback when client disconnects
 * @param {object} options.log - Logger instance
 * @param {string} options.provider - Provider name
 * @param {string} options.model - Model name
 */
export function createStreamController({ externalSignal, onDisconnect, onError, onComplete, onActivity, log, provider, model, reqTag = "" } = {}) {
  const abortController = new AbortController();
  const startTime = Date.now();
  let disconnected = false;
  let externalAbort = null;

  const clearExternalAbort = () => {
    if (!externalAbort) return;
    externalSignal?.removeEventListener("abort", externalAbort);
    externalAbort = null;
  };

  // Only abnormal terminations are logged; normal completion is covered by "📊 done".
  // isError uses errorLine (always shown, ignores LOG_LEVEL) so failures survive quiet levels.
  const logStream = (symbol, status, isError = false) => {
    const duration = Date.now() - startTime;
    const emit = isError ? log?.errorLine : log?.line;
    if (emit) emit(reqTag, symbol, `${status} · ${provider}/${model} · ${duration}ms`);else
    console.log(`[${getTimeString()}] ${symbol} ${provider}/${model} · ${status} · ${duration}ms`);
  };

  const streamController = {
    signal: abortController.signal,
    startTime,

    isConnected: () => !disconnected,

    // Raw upstream activity keeps persistent reservation leases alive. The
    // callback owns throttling so this remains cheap for token-heavy streams.
    handleActivity: () => onActivity?.(),

    // Call when client disconnects
    handleDisconnect: (reason = "client_closed") => {
      if (disconnected) return;
      disconnected = true;
      clearExternalAbort();

      logStream("⚡", `DISCONNECT: ${reason}`);
      dbg("CTRL", `${provider}/${model} | disconnect=${reason} | dur=${Date.now() - startTime}ms`);

      // Stop upstream work before releasing persistent quota capacity. A delayed
      // abort can re-offer the final slot while the old request still consumes it.
      abortController.abort(reason);
      onDisconnect?.({ reason, duration: Date.now() - startTime });
    },

    // Call when stream completes normally (no line here — "📊 done" is authoritative)
    handleComplete: () => {
      if (disconnected) return;
      disconnected = true;
      clearExternalAbort();

      onComplete?.();
    },

    // Call on error
    handleError: (error) => {
      if (disconnected) return;
      disconnected = true;
      clearExternalAbort();

      onError?.(error);

      if (error.name === "AbortError") {
        logStream("⚡", "ABORTED");
        return;
      }

      logStream("✗", `ERROR: ${sanitizeErrorMessage(error?.message || "stream failed")}`, true);
    },

    abort: (reason) => abortController.abort(reason)
  };

  if (externalSignal) {
    externalAbort = () => {
      const reason = isString(externalSignal.reason) ?
      externalSignal.reason :
      externalSignal.reason?.message || "client_closed";
      streamController.handleDisconnect(reason);
    };
    if (externalSignal.aborted) externalAbort();else
    externalSignal.addEventListener("abort", externalAbort, { once: true });
  }

  return streamController;
}

/**
 * Create transform stream with disconnect detection
 * Wraps existing transform stream and adds abort capability.
 *
 * Stall detection lives in pipeWithDisconnect (tied to upstream byte
 * activity), not here — output of the transform stream may be silent
 * for long periods while raw bytes still flow (e.g. Kiro EventStream
 * binary frames buffering, Claude reasoning streams).
 *
 * onClientBytes/onClientEnd/onClientAbort are an optional timeline tap on the
 * exact bytes reaching the client (regular passthrough plus any synthesized
 * terminal/recovery bytes). They are best-effort: a throwing tap must never
 * drop client bytes or otherwise perturb the stream.
 */
export function createDisconnectAwareStream(transformStream, streamController, onAbortTerminal = null, terminalTracker = null, onClientBytes = null, onClientEnd = null, onClientAbort = null) {
  const reader = transformStream.readable.getReader();
  let terminalEmitted = false;
  const decoder = terminalTracker ? new TextDecoder() : null;

  // Forward raw client bytes to the timeline tap (if any), fail-open, then
  // enqueue unconditionally — a broken tap must never drop client bytes.
  const forward = (controller, bytes) => {
    try { onClientBytes?.(bytes); } catch { /* fail-open */ }
    controller.enqueue(bytes);
  };
  const end = () => { try { onClientEnd?.(); } catch { /* fail-open */ } };
  const abort = () => { try { onClientAbort?.(); } catch { /* fail-open */ } };

  // Emit a synthesized terminal payload (e.g. Responses response.failed + [DONE]) once
  const emitTerminal = (controller) => {
    if (terminalEmitted || !onAbortTerminal) return;
    terminalEmitted = true;
    try {
      const bytes = onAbortTerminal();
      if (bytes) forward(controller, bytes);
    } catch { /* best-effort terminal */ }
  };
  const emitClientRecovery = (controller) => {
    if (terminalEmitted || !terminalTracker) return false;
    const bytes = terminalTracker.buildRecoveryBytes();
    if (!bytes) return false;
    terminalEmitted = true;
    forward(controller, bytes);
    return true;
  };

  return new ReadableStream({
    async pull(controller) {
      if (!streamController.isConnected()) {
        emitTerminal(controller);
        abort();
        controller.close();
        return;
      }

      try {
        const { done, value } = await reader.read();

        if (done) {
          const trailingFrame = decoder?.decode();
          if (trailingFrame) terminalTracker.observeClientFrame(trailingFrame);
          if (emitClientRecovery(controller)) {
            streamController.handleError(new Error("upstream stream ended before client terminal"));
            abort();
          } else {
            streamController.handleComplete();
            end();
          }
          controller.close();
          return;
        }
        terminalTracker?.observeClientFrame(decoder.decode(value, { stream: true }));
        forward(controller, value);
      } catch (error) {
        const wasConnected = streamController.isConnected();
        // Controller already closed = downstream ended; not an upstream error, skip noisy log.
        const msg0 = error?.message || "";
        const isControllerClosed = msg0.includes("already closed") || msg0.includes("Invalid state");
        if (!isControllerClosed) streamController.handleError(error);
        reader.cancel().catch(() => {});

        const msg = error?.message || "";
        const code = error?.code || error?.cause?.code || "";
        // Treat caller abort and network resets as graceful close.
        // A relay/connect TimeoutError is NOT caller abort and NOT a network
        // close: it must surface as a hard stream error so the client sees
        // truncated SSE as terminal failure, not clean EOF (Codex P2 on
        // OmniRoute#7093 port). Precedence: named TimeoutError blocks rescue.
        const isRelayTimeout = error?.name === "TimeoutError";
        const isNetworkClose = !isRelayTimeout && (
        error.name === "AbortError" ||
        msg.includes("aborted") ||
        msg.includes("socket hang up") ||
        msg.includes("ECONNRESET") ||
        msg.includes("ETIMEDOUT") ||
        msg.includes("EPIPE") ||
        code === "ECONNRESET" ||
        code === "ETIMEDOUT" ||
        code === "EPIPE" ||
        code === "UND_ERR_SOCKET");


        // Graceful close on network/abort, or when a structured terminal is available.
        // Responses passthrough uses its existing abort terminal; all other known
        // client formats synthesize their EOF recovery through terminalTracker.
        try {
          if (!wasConnected || isNetworkClose || onAbortTerminal) {
            if (terminalTracker) emitClientRecovery(controller);
            else emitTerminal(controller);
            abort();
            controller.close();
          } else {
            abort();
            controller.error(error);
          }
        } catch (e) {/* already closed or cancelled */}
      }
    },

    cancel(reason) {
      streamController.handleDisconnect(reason || "cancelled");
      abort();
      reader.cancel();
    }
  });
}

/**
 * Pipe provider response through transform with disconnect detection.
 *
 * Stall watchdog tracks raw upstream byte activity, not transform output.
 * Reasoning models (Claude thinking via Kiro, etc.) can produce zero SSE
 * output for long stretches while partial EventStream frames keep arriving.
 * Measuring stall on the transform output caused false stalls and the
 * "failed to pipe response" error in Next.
 *
 * Any upstream chunk resets the timer. If no bytes arrive for
 * STREAM_STALL_TIMEOUT_MS, abort the underlying fetch via the controller.
 *
 * @param {Response} providerResponse - Response from provider
 * @param {TransformStream} transformStream - Transform stream for SSE
 * @param {object} streamController - Stream controller from createStreamController
 */
export function pipeWithDisconnect(providerResponse, transformStream, streamController, onAbortTerminal = null, stallTimeoutMs = STREAM_STALL_TIMEOUT_MS, terminalTracker = null, onClientBytes = null, onClientEnd = null, onClientAbort = null) {
  let stallTimer = null;
  let chunkCount = 0;
  let totalBytes = 0;
  let lastChunkAt = Date.now();
  const t0 = Date.now();
  const tag = "STREAM";
  const clearStall = () => {
    if (stallTimer) {clearTimeout(stallTimer);stallTimer = null;}
  };
  const armStall = () => {
    clearStall();
    stallTimer = setTimeout(() => {
      stallTimer = null;
      dbg(tag, `STALL TIMEOUT ${stallTimeoutMs}ms | chunks=${chunkCount} | bytes=${totalBytes} | sinceLast=${Date.now() - lastChunkAt}ms`);
      streamController.handleError?.(new Error("stream stall timeout"));
      streamController.abort?.();
    }, stallTimeoutMs);
  };

  // Wrap controller so every termination path clears the stall timer.
  // Without this, abort/cancel/downstream-error paths leave the timer armed
  // and a stale abort could fire after the request has already ended.
  const wrappedController = {
    signal: streamController.signal,
    startTime: streamController.startTime,
    isConnected: () => streamController.isConnected(),
    handleComplete: () => {dbg(tag, `complete | chunks=${chunkCount} | bytes=${totalBytes} | dur=${Date.now() - t0}ms`);clearStall();streamController.handleComplete();},
    handleError: (e) => {dbg(tag, `error: ${e?.message} | chunks=${chunkCount} | bytes=${totalBytes} | dur=${Date.now() - t0}ms`);clearStall();streamController.handleError(e);},
    handleDisconnect: (r) => {dbg(tag, `disconnect: ${r} | chunks=${chunkCount} | bytes=${totalBytes} | dur=${Date.now() - t0}ms`);clearStall();streamController.handleDisconnect(r);},
    abort: () => {clearStall();streamController.abort();},
    handleActivity: () => streamController.handleActivity?.()
  };

  armStall();
  dbg(tag, `pipe start | stallTimeout=${stallTimeoutMs}ms`);

  const upstreamTap = new TransformStream({
    transform(chunk, controller) {
      chunkCount++;
      const sz = chunk?.byteLength || chunk?.length || 0;
      totalBytes += sz;
      const now = Date.now();
      const gap = now - lastChunkAt;
      lastChunkAt = now;
      wrappedController.handleActivity();
      if (isDebugEnabled && (chunkCount <= 5 || chunkCount % 20 === 0 || gap > 5000)) {
        dbg(tag, `chunk #${chunkCount} | size=${sz}B | gap=${gap}ms | total=${totalBytes}B`);
      }
      armStall();
      controller.enqueue(chunk);
    },
    flush() {dbg(tag, `upstream EOF | chunks=${chunkCount} | bytes=${totalBytes} | dur=${Date.now() - t0}ms`);clearStall();}
  });

  const transformedBody = providerResponse.body.
  pipeThrough(upstreamTap).
  pipeThrough(transformStream);

  return createDisconnectAwareStream(
    { readable: transformedBody },
    wrappedController,
    onAbortTerminal,
    terminalTracker,
    onClientBytes,
    onClientEnd,
    onClientAbort,
  );
}
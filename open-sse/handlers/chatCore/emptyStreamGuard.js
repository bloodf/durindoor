// Empty-stream guard for Antigravity/AGY — oh-my-pi parity.
//
// Gemini occasionally answers HTTP 200 with a stream that carries no usable
// output (no candidates at all, thought-only parts, a bare STOP with empty
// text) or aborts the turn (MALFORMED_FUNCTION_CALL) before emitting anything.
// Delivered as-is the client receives a blank turn and silently halts
// (#2188, #2229, #2250, #2259).
//
// Mirrors oh-my-pi: complete frames — thinking included — stream to the client
// live; emptiness is judged per upstream attempt, after the fact. An attempt
// that ends without meaningful content has its terminal event withheld and is
// retried in place with the identical request; the retried attempt splices
// into the same client stream (the translator inits its message once, so the
// splice continues the same client message). Accepted wart, same as oh-my-pi:
// the client may see thinking from a discarded attempt followed by the retry's
// thinking inside one message. On exhaustion an {error:{...}} event is emitted
// in-stream — the gemini translator turns it into the client-facing error
// finish, which Anthropic clients treat as retryable.
//
// A provider terminal completes the response. Some upstreams hold the socket
// open after it instead of sending EOF, so the attempt closes the client
// stream itself once a short trailing-byte drain window expires (#1073).
//
// The drain window is bounded, absolute and one-shot:
//   - the deadline is established on the FIRST forwarded provider terminal and
//     is never moved again, so a later terminal frame cannot extend it;
//   - the deadline is checked explicitly before every read. A zero-delay timer
//     loses the race against an upstream read that is already ready, so a
//     chatty upstream could otherwise hold a finished turn open for ever
//     instead of letting the window expire;
//   - only late usage is drained inside the window: a repeated terminal frame
//     is dropped, so the client never sees a second terminal or completion.
import { GEMINI_FINISH, GEMINI_ERROR_FINISH_REASONS, GEMINI_CONTENT_FILTER_FINISH_REASONS } from "../../translator/schema/finishReasons.js";
import { STREAM_STALL_TIMEOUT_MS } from "../../config/runtimeConfig.js";
import { isQuotaDispatchUnavailable } from "../../services/quota/dispatch.js";
import { createSseFrameReader, parseResponsesSseData } from "../../utils/sseFrames.js";

// Mirrors oh-my-pi's empty-response policy: 2 retries, 500ms * 2^attempt backoff.
import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";
export const EMPTY_STREAM_MAX_RETRIES = 2;
export const EMPTY_STREAM_BASE_DELAY_MS = 500;

// A confirmed provider terminal completes the response: the upstream is not
// required to send EOF after it (some Antigravity relays hold the socket
// open). The attempt still gets a short, bounded window to deliver trailing
// usage bytes, then the stream closes as a normal completion instead of
// failing with a raw-byte stall. Never longer than the raw-byte stall budget,
// so a completed attempt can never wait longer than it did before.
export const TERMINAL_DRAIN_TIMEOUT_MS = 1000;

// The usage counters of a frame, plus a stable signature of them. A repeated
// terminal frame is dropped from the wire (its completion was already
// delivered) but its usage still has to reach the client, so it is drained
// candidate-less — the framing the translators already harvest usage from.
function usagePayload(parsed) {
  const response = parsed?.response || parsed;
  const usage = response?.usageMetadata || parsed?.usageMetadata;
  if (!usage || !isObject(usage)) return null;
  let signature;
  try { signature = JSON.stringify(usage); } catch { return null; }
  if (!signature) return null;
  const frame = parsed?.response ?
  { response: { usageMetadata: usage } } :
  { usageMetadata: usage };
  return { frame, signature };
}

// An in-stream error envelope is not a repeated completion: the client still
// has to learn that the attempt failed, so it is forwarded as it is.
function hasErrorEnvelope(parsed) {
  const response = parsed?.response || parsed;
  return Boolean(response?.error || parsed?.error);
}

// A part is meaningful when it carries output the client can act on: a tool
// call, inline data, or non-whitespace visible text. Thought-only parts are
// not — thinking that never produced an answer IS the empty-response failure
// (#2229). Thought parts still stream to the client live; they just don't mark
// the attempt as non-empty.
export function isMeaningfulPart(part) {
  if (part.functionCall) return true;
  if (part.inlineData?.data || part.inline_data?.data) return true;
  if (part.thought === true) return false;
  return isString(part.text) && part.text.trim().length > 0;
}

// Decide what to do with one parsed SSE event.
// - forward: pass the original line through (optionally marking the stream
//   terminal so the attempt is never retried)
// - hold: withhold it — it is the terminal of an empty attempt; the message
//   must stay open so the retried attempt can splice in.
function classifyEvent(parsed, meaningfulSeen) {
  // Antigravity wrapper
  const response = parsed.response || parsed;
  if (!response || !isObject(response)) return { action: "forward" };

  const errorObj = response.error || parsed.error;
  if (errorObj) {
    // Embedded error object in a 200 stream. After content: forward — the
    // translator closes the message with the error finish. Before content:
    // withhold and retry (usually transient, e.g. RESOURCE_EXHAUSTED blips).
    if (meaningfulSeen) return { action: "forward", terminal: true };
    return { action: "hold", kind: "error_object", reason: errorObj.status || errorObj.message || "error", error: errorObj };
  }

  // Prompt blocked by policy: deterministic for this prompt — never retried.
  // Forward so the translator closes the stream as content_filter (#2188).
  if (!response.candidates?.length && response.promptFeedback?.blockReason) {
    return { action: "forward", terminal: true };
  }

  const candidate = response.candidates?.[0];
  if (!candidate) return { action: "forward" }; // keep-alive / usage-only

  let meaningful = false;
  for (const part of candidate.content?.parts || []) {
    if (isMeaningfulPart(part)) {meaningful = true;break;}
  }

  const finishReason = candidate.finishReason && String(candidate.finishReason).toUpperCase();
  if (!finishReason) return { action: "forward", meaningful };

  // Content blocks and token exhaustion are deterministic whatever the content
  // — retrying re-runs the same outcome (oh-my-pi never retries these either).
  if (GEMINI_CONTENT_FILTER_FINISH_REASONS.has(finishReason) || finishReason === GEMINI_FINISH.MAX_TOKENS) {
    return { action: "forward", meaningful, terminal: true };
  }

  // Any other finish (bare STOP, MALFORMED_FUNCTION_CALL family, unknown) with
  // content forwards normally — the translator emits the tool_calls upgrade or
  // the error event. Without content it is the empty attempt's terminal.
  if (meaningful || meaningfulSeen) return { action: "forward", meaningful, terminal: true };
  return {
    action: "hold",
    kind: GEMINI_ERROR_FINISH_REASONS.has(finishReason) ? "error_finish" : "stop",
    reason: finishReason
  };
}

/**
 * Wrap the upstream SSE body so empty attempts are retried in-stream.
 *
 * A confirmed provider terminal (finish reason, content filter, prompt
 * feedback or an in-stream error after content) completes the response: the
 * attempt closes the client stream normally once the trailing-byte drain
 * window expires, so an upstream that never sends EOF after its terminal
 * cannot turn a finished turn into a stall error (#1073). The window is
 * bounded: its deadline is established on the first forwarded terminal, it is
 * never extended by a later frame, and it is checked explicitly before every
 * read, so neither repeated terminal metadata nor a ready read can hold a
 * finished turn open. A stalled attempt that never confirmed a terminal stays
 * a status-neutral failure: it settles its dispatch reservation, is not
 * retried and does not cool the account.
 *
 * @param {ReadableStream} options.body       attempt 1's body
 * @param {() => Promise<ReadableStream>} options.reexecute  re-issue the
 *   identical request; resolves to the new attempt's body, throws on failure
 * @param {AbortSignal} options.signal        client-disconnect signal
 * @param {object} options.log
 * @param {number} options.stallTimeoutMs     per-read stall escape
 * @param {(reason: string, meta: { upstreamError: object|null }) => void|Promise<void>} options.onExhausted
 *   observer for "every attempt came back empty" (e.g. bench the account so
 *   client retries rotate); awaited before the error event is emitted, and
 *   handed the held upstream error object so quota reset times can be parsed,
 *   plus the HTTP `status` of a retry the upstream rejected
 * @returns {ReadableStream} byte stream for the SSE transform pipeline
 */
export function createEmptyRetryStream({
  body,
  reexecute,
  signal,
  log,
  stallTimeoutMs = STREAM_STALL_TIMEOUT_MS,
  baseDelayMs = EMPTY_STREAM_BASE_DELAY_MS,
  onAttemptDiscarded,
  onExhausted,
  onInBandError
}) {
  const encoder = new TextEncoder();
  let currentReader = null;
  let currentBody = body;
  let downstreamGone = false;
  // Trailing-byte budget for an attempt that already confirmed a provider
  // terminal. It can never exceed the raw-byte stall budget.
  const terminalDrainTimeoutMs = Math.min(stallTimeoutMs, TERMINAL_DRAIN_TIMEOUT_MS);

  return new ReadableStream({
    async start(controller) {
      currentReader = body.getReader();
      let meaningfulSeen = false;
      let lastHeld = null; // last withheld terminal, kept for the exhaustion event

      const emit = (text) => {
        if (downstreamGone) return;
        try {controller.enqueue(encoder.encode(text));} catch {downstreamGone = true;}
      };
      const closeStream = () => {
        if (downstreamGone) return;
        try {controller.close();} catch {/* already closed */}
      };
      // Release the upstream reader. A relay that holds the socket open after
      // its terminal would otherwise keep the connection alive after the
      // response is complete.
      const cancelUpstream = () => {
        try {currentReader?.cancel?.()?.catch?.(() => {});} catch {/* already closed */}
      };
      const abortStream = () => {
        // cancel() rejects when the stream already errored — swallow the promise too
        cancelUpstream();
        if (downstreamGone) return;
        const err = new Error("Request aborted");
        err.name = "AbortError";
        try {controller.error(err);} catch {/* already closed */}
      };
      const exhaust = async (reason, { notifyProvider = true, status } = {}) => {
        // Bench-before-emit: the error event triggers the client's automatic
        // retry, so the observer (account bench) must complete first or the
        // retry can land on the account that just failed.
        try {
          if (notifyProvider) {
            await Promise.resolve(onExhausted?.(reason, { upstreamError: lastHeld?.error || null, status }));
          }
        } catch {/* observer must not break the stream */}
        // Re-emit the real upstream error when we held one (true status/message,
        // e.g. RESOURCE_EXHAUSTED); otherwise synthesize an embedded error. The
        // gemini translator converts either into the client-facing error finish.
        const line = lastHeld?.kind === "error_object" ?
        lastHeld.line :
        `data: ${JSON.stringify({ error: { code: 502, status: "EMPTY_RESPONSE", message: reason } })}`;
        emit(`${line}\n\n`);
        closeStream();
      };

      for (let attempt = 0;; attempt++) {
        const decoder = new TextDecoder();
        const frameReader = createSseFrameReader();
        let held = null; // this attempt's withheld terminal
        let terminalForwarded = false;
        // Absolute deadline of the trailing-byte drain window. It is
        // established once, on the first forwarded provider terminal, and is
        // never moved again — a later terminal frame cannot extend it.
        let terminalDrainDeadline = null;
        // Signature of the usage counters already forwarded, so a repeated
        // terminal that repeats the same usage is dropped instead of
        // re-sending it.
        let forwardedUsageSignature = null;
        let endReason = "empty";

        // Classify whole frames so multi-line data and CRLF share the same
        // interpretation as the other SSE consumers. Preserve their wire bytes.
        const processFrame = (frame) => {
          if (held) return;
          const wire = frame.wire ?? frame.raw;
          if (!frame.hasData || !frame.data || frame.data === "[DONE]") { emit(wire); return; }
          // Some providers append a separate JSON trailer in the same frame.
          let event;
          try { event = parseResponsesSseData(frame); }
          catch { emit(wire); return; }
          if (event.rawDone) { emit(wire); return; }
          const { parsed } = event;
          if (hasErrorEnvelope(parsed)) onInBandError?.(parsed.error || parsed.response?.error, currentBody);
          const decision = classifyEvent(parsed, meaningfulSeen);
          if (decision.meaningful) meaningfulSeen = true;
          if (decision.action === "hold") {
            held = { kind: decision.kind, reason: decision.reason, error: decision.error || null, line: frame.raw };
            lastHeld = held;
            return;
          }
          if (decision.terminal) {
            if (!terminalForwarded) {
              terminalForwarded = true;
              terminalDrainDeadline = Date.now() + terminalDrainTimeoutMs;
            } else {
              if (hasErrorEnvelope(parsed)) { emit(wire); return; }
              const drained = usagePayload(parsed);
              if (drained && drained.signature !== forwardedUsageSignature) {
                forwardedUsageSignature = drained.signature;
                emit(`data: ${JSON.stringify(drained.frame)}\n\n`);
              }
              return;
            }
          }
          const forwarded = usagePayload(parsed);
          if (forwarded) forwardedUsageSignature = forwarded.signature;
          emit(wire);
        };

        readAttempt: while (true) {
          if (signal?.aborted) return abortStream();

          // The drain deadline is absolute and checked explicitly: a
          // zero-delay timer loses the race against an upstream read that is
          // already ready, and the window would never expire.
          if (terminalForwarded && Date.now() >= terminalDrainDeadline) break readAttempt;

          let readResult;
          let stallTimer;
          // Before the terminal the read is bounded by the raw-byte stall
          // budget. After it, only the trailing-byte drain budget is left: the
          // response is already complete, so the remaining wait must not
          // stretch to the full stall timeout. The budget is never zero, so a
          // ready read cannot pre-empt the timer that closes the window.
          const readBudgetMs = terminalForwarded ?
          Math.max(1, terminalDrainDeadline - Date.now()) :
          stallTimeoutMs;
          try {
            // Defensive stall escape: a byte-silent upstream must not hang the pipe.
            readResult = await Promise.race([
            currentReader.read(),
            new Promise((resolve) => {stallTimer = setTimeout(() => resolve({ __stalled: true }), readBudgetMs);})]
            );
          } catch {
            // A client abort rejects the pending read — never treat it as an
            // empty attempt or a disconnect turns into a retry/error.
            if (signal?.aborted) return abortStream();
            endReason = "read_error";
            break readAttempt; // truncated attempt
          } finally {
            clearTimeout(stallTimer);
          }
          if (readResult.__stalled) {
            cancelUpstream();
            if (held?.kind === "error_object") {
              endReason = "stall";
              break readAttempt;
            }
            if (terminalForwarded) {
              // The provider already confirmed its terminal, so the response is
              // complete even though the upstream never sent EOF. Close it as a
              // normal completion: no stall error, and no failed dispatch for a
              // turn that actually answered.
              break readAttempt;
            }
            // A stalled request says nothing about account health. Settle its
            // reservation, but neither retry it nor trigger the empty-account
            // cooldown reserved for completed empty responses.
            try { await Promise.resolve(onAttemptDiscarded?.(currentBody, "stall", { final: true })); }
            catch { return exhaust("local quota reservation settlement failed", { notifyProvider: false }); }
            if (!downstreamGone) controller.error(new Error("stream stall timeout"));
            return;
          }

          const { done, value } = readResult;
          try {
            const frames = frameReader.push(done ? decoder.decode() : decoder.decode(value, { stream: true }));
            if (done) frames.push(...frameReader.flush());
            for (const frame of frames) processFrame(frame);
          } catch (error) {
            cancelUpstream();
            controller.error(error);
            return;
          }
          if (done) break readAttempt;
        }

        // Attempt over. Content or a forwarded terminal ends the stream here —
        // a truncated-with-content attempt is closed by the translator's flush
        // finalization and is never retried (replay-unsafe, as in oh-my-pi).
        if (meaningfulSeen || terminalForwarded) {
          if (!held) {
            for (const frame of frameReader.push(decoder.decode())) processFrame(frame);
            for (const frame of frameReader.flush()) processFrame(frame);
          }
          // The attempt is complete: release the upstream reader so a relay
          // that holds the socket open after its terminal does not keep the
          // connection alive.
          cancelUpstream();
          closeStream();
          return;
        }

        const reason = held ? held.reason : endReason;
        log?.warn?.("STREAM", `ANTIGRAVITY | empty (${reason}) | attempt ${attempt + 1}/${EMPTY_STREAM_MAX_RETRIES + 1}`);

        try {
          await Promise.resolve(onAttemptDiscarded?.(currentBody, reason, {
            final: attempt >= EMPTY_STREAM_MAX_RETRIES
          }));
        } catch (error) {
          return exhaust("local quota reservation settlement failed", { notifyProvider: false });
        }

        if (attempt >= EMPTY_STREAM_MAX_RETRIES) {
          return exhaust(`empty response from upstream (${reason}) after ${attempt + 1} attempts`);
        }

        // Abort-aware backoff, then splice the retried attempt into this stream.
        await new Promise((resolve) => {
          const t = setTimeout(resolve, baseDelayMs * 2 ** attempt);
          signal?.addEventListener?.("abort", () => {clearTimeout(t);resolve();}, { once: true });
        });
        if (signal?.aborted) return abortStream();

        try {
          currentBody = await reexecute();
          currentReader = currentBody.getReader();
        } catch (error) {
          if (error?.name === "AbortError" || signal?.aborted) return abortStream();
          return exhaust(error?.message || "retry request failed", {
            status: error?.upstreamStatus,
            notifyProvider: !isQuotaDispatchUnavailable(error)
          });
        }
      }
    },

    cancel(reason) {
      downstreamGone = true;
      try {currentReader?.cancel(reason)?.catch?.(() => {});} catch {/* already closed */}
    }
  });
}

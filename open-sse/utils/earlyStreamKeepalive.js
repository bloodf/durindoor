/**
 * Early SSE keepalive wrapper for streaming route handlers.
 *
 * Strict HTTP clients (e.g. Codex CLI's `reqwest`, Claude Code/Anthropic SDK)
 * drop the connection if no bytes arrive shortly after the request. The proxy
 * may hold the streaming response until the upstream's first useful byte, which
 * can exceed those idle timeouts for reasoning models. This wrapper keeps the
 * connection warm without disturbing the handler's internal logic.
 *
 * Fast path: if the handler resolves within `thresholdMs`, its `Response` is
 * returned verbatim. Slow path: after `thresholdMs`, a 200 `text/event-stream`
 * response is opened and SSE keepalive frames are emitted until the handler
 * resolves; its body is then forwarded. If the handler ultimately fails, an
 * error frame in the client's wire format is emitted in-band (see `errorFormat`).
 * The 200 is already committed by then, so the frame carries the handler's HTTP
 * status and retry hint instead.
 */
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";
import { ERROR_TYPES } from "../config/errorConfig.js";

const ENCODER = new TextEncoder();
const DEFAULT_KEEPALIVE_FRAME = ENCODER.encode(": keepalive\n\n");
// Anthropic Messages-format keepalive: a real `ping` SSE event. Anthropic clients
// reset their stream watchdog on real SSE events but ignore SSE comments.
export const ANTHROPIC_PING_FRAME = ENCODER.encode(
  'event: ping\ndata: {"type":"ping"}\n\n'
);
const FALLBACK_ERROR_MESSAGE = "Upstream stream failed before completion.";
const MAX_RETRY_AFTER_SECONDS = 3600;
// Responses API events carry a sequence_number. These frames are built outside the
// per-stream counter (which numbers the first real event 1), and after a keepalive
// commit the error is the only event on the stream, so it takes the first number.
const SYNTHETIC_RESPONSES_SEQUENCE_NUMBER = 1;
// Anthropic Messages error types by HTTP status.
const ANTHROPIC_ERROR_TYPES = {
  400: "invalid_request_error",
  401: "authentication_error",
  402: "billing_error",
  403: "permission_error",
  404: "not_found_error",
  413: "request_too_large",
  429: "rate_limit_error",
  503: "overloaded_error",
  504: "timeout_error",
  529: "overloaded_error"
};

/**
 * Seconds a client should wait before retrying, from the handler's `Retry-After`
 * header (delta-seconds or HTTP-date), clamped to 0..3600. Null when absent or unusable.
 * @param {Headers} headers
 * @returns {number|null}
 */
function readRetryAfterSeconds(headers) {
  const raw = headers.get("retry-after")?.trim();
  if (!raw) return null;
  let seconds = null;
  if (/^\d{1,10}$/.test(raw)) {
    seconds = Number(raw);
  } else {
    const at = Date.parse(raw);
    if (Number.isFinite(at)) seconds = Math.ceil((at - Date.now()) / 1000);
  }
  return seconds === null ? null : Math.min(Math.max(seconds, 0), MAX_RETRY_AFTER_SECONDS);
}

function parseErrorBody(text) {
  const trimmed = text.trim();
  let parsed = null;
  try {
    parsed = trimmed ? JSON.parse(trimmed) : null;
  } catch {
    parsed = null;
  }
  const body = isObject(parsed) ? parsed : null;
  const error = isObject(body?.error) ? body.error : null;
  const message =
  isString(error?.message) && error.message ||
  isString(body?.message) && body.message ||
  trimmed ||
  FALLBACK_ERROR_MESSAGE;
  return { body, error, message };
}

/**
 * Build the in-band error frame sent after the keepalive stream committed to 200.
 *
 * - `responses`: an OpenAI Responses `error` event (`type`, `code`, `message`,
 *   `param`, `sequence_number`) plus flat `status_code`, `error_type` and
 *   `retry_after_seconds`. The fields stay flat: `type` is the event discriminator,
 *   and a top-level `error` key makes openai-node throw instead of yielding the event.
 * - `chat`: a Chat Completions `data: {"error":{...}}` line with no `event:` field;
 *   `status_code` and `retry_after_seconds` go inside `error`.
 * - `claude`: an Anthropic `event: error` with `{"type":"error","error":{type,message}}`;
 *   `status_code` and `retry_after_seconds` go inside `error`.
 *
 * @param {"chat"|"responses"|"claude"} format
 * @param {{ text?: string, status?: number|null, retryAfterSeconds?: number|null }} [failure]
 *   The handler's error response; omitted when the handler threw.
 * @returns {Uint8Array}
 */
export function buildKeepaliveErrorFrame(format, { text = "", status = null, retryAfterSeconds = null } = {}) {
  const { body, error, message } = parseErrorBody(text);
  const meta = {};
  if (status !== null) meta.status_code = status;
  if (retryAfterSeconds !== null) meta.retry_after_seconds = retryAfterSeconds;
  if (format === "responses") {
    const event = {
      type: "error",
      code: isString(error?.code) && error.code || null,
      message,
      param: isString(error?.param) && error.param || null,
      sequence_number: SYNTHETIC_RESPONSES_SEQUENCE_NUMBER,
      ...meta
    };
    if (isString(error?.type) && error.type) event.error_type = error.type;
    return ENCODER.encode(`event: error\ndata: ${JSON.stringify(event)}\n\n`);
  }
  if (format === "claude") {
    const type =
    body?.type === "error" && isString(error?.type) && error.type ||
    ANTHROPIC_ERROR_TYPES[status] ||
    "api_error";
    return ENCODER.encode(`event: error\ndata: ${JSON.stringify({
      type: "error",
      error: { type, message, ...meta }
    })}\n\n`);
  }
  return ENCODER.encode(`data: ${JSON.stringify({
    error: {
      ...error,
      message,
      type: isString(error?.type) && error.type || ERROR_TYPES[status]?.type || "stream_error",
      ...meta
    }
  })}\n\n`);
}

function normalizeError(maybeError) {
  if (maybeError instanceof Error) return maybeError;
  return new Error(
    isString(maybeError) ? maybeError : "Upstream handler failed"
  );
}

/**
 * Open an SSE response while a streaming handler is still resolving.
 * `intervalMs=0` disables the wrapper and returns the handler response unchanged.
 *
 * @param {Promise<Response>} handlerPromise
 * @param {object} [options]
 * @param {number} [options.thresholdMs=2000]
 * @param {number} [options.intervalMs=2500]
 * @param {AbortSignal|null} [options.signal]
 * @param {Uint8Array} [options.keepaliveFrame]
 * @param {"chat"|"responses"|"claude"} [options.errorFormat="chat"] Wire format of the
 *   in-band error frame sent when the handler fails after the stream committed.
 * @returns {Promise<Response>}
 */
export async function withEarlyStreamKeepalive(handlerPromise, options = {}) {
  if (options.intervalMs === 0) return await handlerPromise;
  const thresholdMs = Math.max(0, options.thresholdMs ?? 2_000);
  const intervalMs = Math.max(250, options.intervalMs ?? 2_500);
  const signal = options.signal ?? null;
  const keepaliveFrame = options.keepaliveFrame ?? DEFAULT_KEEPALIVE_FRAME;
  const errorFormat = options.errorFormat ?? "chat";
  const fallbackErrorFrame = buildKeepaliveErrorFrame(errorFormat);

  const settled = handlerPromise.then(
    (response) => ({ ok: true, response }),
    (error) => ({ ok: false, error: normalizeError(error) })
  );

  let timer;
  const raced = await Promise.race([
  settled.then((result) => ({ kind: "settled", result })),
  new Promise((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), thresholdMs);
  })]
  );
  if (timer) clearTimeout(timer);

  if (raced.kind === "settled") {
    if (raced.result.ok) return raced.result.response;
    throw raced.result.error;
  }

  let stopKeepalive = () => {};
  let upstreamReader = null;
  let aborted = false;

  const stream = new ReadableStream({
    async start(controller) {
      let stopped = false;
      const interval = setInterval(() => {
        if (stopped) return;
        try {
          controller.enqueue(keepaliveFrame);
        } catch {
          stopped = true;
          clearInterval(interval);
        }
      }, intervalMs);
      if (interval && isObject(interval) && "unref" in interval) {
        interval.unref?.();
      }
      try {
        controller.enqueue(keepaliveFrame);
      } catch {

        /* consumer already gone */}

      stopKeepalive = () => {
        stopped = true;
        clearInterval(interval);
      };

      const onAbort = () => {
        aborted = true;
        stopKeepalive();
        upstreamReader?.cancel().catch(() => {});
        try {
          controller.close();
        } catch {

          /* already closed */}
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      try {
        const result = await settled;
        stopKeepalive();
        if (aborted) return;

        if (!result.ok) {
          controller.enqueue(fallbackErrorFrame);
        } else {
          const response = result.response;
          const contentType = (response.headers.get("content-type") || "").toLowerCase();
          const isSse = contentType.includes("text/event-stream");

          if (response.body && isSse) {
            upstreamReader = response.body.getReader();
            while (true) {
              const { done, value } = await upstreamReader.read();
              if (done) break;
              if (value) controller.enqueue(value);
            }
          } else {
            const text = response.body ?
            await response.text().catch(() => "") :
            "";
            controller.enqueue(buildKeepaliveErrorFrame(errorFormat, {
              text,
              status: response.status,
              retryAfterSeconds: readRetryAfterSeconds(response.headers)
            }));
          }
        }
      } catch {
        if (!aborted) {
          try {
            controller.enqueue(fallbackErrorFrame);
          } catch {

            /* consumer gone */}
        }
      } finally {
        stopKeepalive();
        signal?.removeEventListener("abort", onAbort);
        try {
          controller.close();
        } catch {

          /* already closed */}
      }
    },
    cancel() {
      aborted = true;
      stopKeepalive();
      upstreamReader?.cancel().catch(() => {});
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
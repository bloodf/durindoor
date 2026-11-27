// UC persona WebSocket driver. Port of OmniRoute c71f0065
// open-sse/executors/uc/ws.ts (buildUcWsUrl, runUcTurn):
//
//   wss://internal-6.pubyar.com/ws/{uid}?token={jwt}&_t={epoch ms}
//   upgrade header: Origin: https://uncensored.com   (no Cookie, no Authorization)
//   SEND one persona frame, RECV newline-delimited frames until end_of_stream
//
// Fork deviations: redirects are refused; a non-101 upgrade answer is a
// handshake failure with its status; per-frame, per-turn and split-frame
// byte caps; a handshake deadline, an idle deadline between messages and a
// total deadline; a socket that closes or errors before end_of_stream after
// the frame left is a truncated turn (the source returned the partial text as
// a success); the result says whether the frame left and whether any frame
// came back, so the caller can mark accepted or uncertain work and never
// replay it.
import { Buffer } from "node:buffer";
import WebSocket from "ws";
import { isFunction, isNumber, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  UC_HANDSHAKE_TIMEOUT_MS, UC_IDLE_TIMEOUT_MS, UC_MAX_FRAME_BYTES, UC_MAX_TURN_BYTES, UC_ORIGIN, UC_WS_HOST, UC_WS_TIMEOUT_MS,
} from "./config.js";
import { UcFrameParser } from "./stream.js";

let WebSocketCtor = WebSocket;
/** Swap the WebSocket constructor (tests). Returns a restore function. */
export function __setUcChatWebSocketForTesting(ctor) {
  const previous = WebSocketCtor;
  WebSocketCtor = ctor;
  return () => {
    WebSocketCtor = previous;
  };
}

/** Source socket URL. It carries the session JWT: never log or return it. */
export const buildUcWsUrl = (uid, jwt, now = Date.now()) =>
  `${UC_WS_HOST}/${encodeURIComponent(uid)}?token=${encodeURIComponent(jwt)}&_t=${now}`;

function frameText(data) {
  if (isString(data)) return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  return "";
}
const frameBytes = (data) => (isString(data) ? Buffer.byteLength(data) : Array.isArray(data) ? data.reduce((n, b) => n + (b?.byteLength ?? 0), 0) : data?.byteLength ?? 0);

/**
 * Drive one persona turn. Never rejects. Resolves
 *   { outcome, sent, received, content, reasoning, error?, errorCode?, nextReset?, handshakeStatus?, retryAfter?, closeCode? }
 * outcome: complete | upstream-error | aborted | timeout | idle | handshake |
 *          connect | closed | too-large | send-failed
 * `sent`: the frame was handed to the socket. `received`: at least one message came back.
 * onSent() fires once right after the frame left; onEvent(evt) for each parsed event.
 */
export function runUcTurn({
  url, frame, signal, agent = null, onSent, onEvent,
  timeoutMs = UC_WS_TIMEOUT_MS, handshakeTimeoutMs = UC_HANDSHAKE_TIMEOUT_MS, idleTimeoutMs = UC_IDLE_TIMEOUT_MS,
  maxFrameBytes = UC_MAX_FRAME_BYTES, maxTurnBytes = UC_MAX_TURN_BYTES, WebSocketImpl = WebSocketCtor,
}) {
  return new Promise((resolve) => {
    const parser = new UcFrameParser({ maxCarryBytes: maxFrameBytes });
    const reasoning = [];
    let sent = false;
    let received = false;
    let turnBytes = 0;
    let settled = false;
    let ws = null;
    const timers = {};
    const clear = (name) => {
      if (timers[name]) clearTimeout(timers[name]);
      timers[name] = null;
    };
    const finish = (outcome, extra = {}) => {
      if (settled) return;
      settled = true;
      for (const name of Object.keys(timers)) clear(name);
      signal?.removeEventListener("abort", onAbort);
      try {
        if (outcome === "complete" || outcome === "upstream-error") ws?.close?.();
        else if (isFunction(ws?.terminate)) ws.terminate();
        else ws?.close?.();
      } catch {
        // already closed
      }
      resolve({ outcome, sent, received, content: parser.finalText(), reasoning: reasoning.join(""), ...extra });
    };
    const emit = (evt) => {
      try {
        onEvent?.(evt);
      } catch {
        // a consumer failure never breaks the turn bookkeeping
      }
    };
    const onAbort = () => finish("aborted");
    if (signal?.aborted) return finish("aborted");
    signal?.addEventListener("abort", onAbort, { once: true });
    const arm = (name, ms, outcome) => {
      clear(name);
      timers[name] = setTimeout(() => finish(outcome), Math.max(1, ms));
    };
    arm("total", timeoutMs, "timeout");
    arm("handshake", handshakeTimeoutMs, "timeout");

    try {
      ws = new WebSocketImpl(url, {
        headers: { Origin: UC_ORIGIN },
        followRedirects: false,
        maxRedirects: 0,
        maxPayload: maxFrameBytes,
        handshakeTimeout: Math.max(1, handshakeTimeoutMs),
        ...(agent ? { agent } : null),
      });
    } catch {
      return finish("connect");
    }

    if (isFunction(ws.on)) {
      ws.on("unexpected-response", (_request, response) => {
        const status = response?.statusCode;
        response?.resume?.();
        finish("handshake", { handshakeStatus: isNumber(status) ? status : 0, retryAfter: response?.headers?.["retry-after"] ?? null });
      });
    }

    ws.onopen = () => {
      if (settled) return;
      clear("handshake");
      arm("idle", idleTimeoutMs, "idle");
      try {
        ws.send(JSON.stringify(frame));
      } catch {
        return finish("send-failed");
      }
      sent = true;
      try {
        onSent?.();
      } catch {
        // ignore
      }
    };

    ws.onmessage = (event) => {
      if (settled) return;
      received = true;
      arm("idle", idleTimeoutMs, "idle");
      const bytes = frameBytes(event?.data);
      turnBytes += bytes;
      if (bytes > maxFrameBytes || turnBytes > maxTurnBytes) return finish("too-large");
      let events;
      try {
        events = parser.feed(frameText(event?.data));
      } catch {
        return finish("too-large");
      }
      for (const evt of events) {
        if (evt.kind === "reasoning") reasoning.push(evt.text);
        emit(evt);
        if (settled) return;
        if (evt.kind === "done") return finish("complete", { content: evt.text });
        if (evt.kind === "error") {
          const failure = { error: evt.text, errorCode: evt.code };
          if (evt.nextReset) failure.nextReset = evt.nextReset;
          return finish("upstream-error", failure);
        }
      }
    };

    ws.onerror = () => finish(sent ? "closed" : "connect");
    ws.onclose = (event) => {
      if (settled) return;
      finish(sent ? "closed" : "connect", { closeCode: event?.code });
    };
  });
}

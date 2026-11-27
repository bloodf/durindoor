// One bounded fal WebSocket session: handshake, abort, frame, send-buffer,
// output-queue and idle limits, and single-shot cleanup. Never reconnects or
// replays.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/fal/socket.ts (FalSocket: `Authorization: Key <token>`,
// followRedirects false, handshakeTimeout 15 s, maxPayload 32 MiB; an HTTP(S)
// proxy through HttpsProxyAgent and any other proxy refused with 409; output
// as SSE `data:` lines with `event: <name>` for non-message events; the
// socket is paused when the output stream is full and resumed on pull; an
// abort or close while a submission may be in flight emits an
// `error` event with status SUBMISSION_UNKNOWN; a send whose callback fails is
// uncertain; sends past a 1 MiB buffered amount are refused with 429; sends
// after close are refused with 410; close terminates the socket once and
// calls onClose once).
//
// Fork deviations: a local handshake deadline also covers socket factories
// that never open or fail; an abort before open rejects with 499 (the source
// uses 504); an idle timer closes a session that has seen no frame in either
// direction for `idleTimeoutMs`; output beyond `maxQueuedOutputBytes` that the
// reader has not taken closes the session; frames are checked against
// `maxFrameBytes` again after receipt. Every error raised to the caller is a
// fixed message: no upstream text, URL or key is ever copied into it.
import { WebSocket } from "ws";
import { FAL_REALTIME_LIMITS } from "./config.js";
import { FalRealtimeError } from "./schema.js";

const OPEN = 1;
const encoder = new TextEncoder();

/** SSE bytes for one event; `message` events have no `event:` line (source FalSocket.emit). */
export function falRealtimeSseEvent(event, data) {
  const prefix = event === "message" ? "" : `event: ${event}\n`;
  return encoder.encode(`${prefix}data: ${JSON.stringify(data)}\n\n`);
}

async function proxyAgent(proxyUrl, agentFactory) {
  if (!proxyUrl) return undefined;
  let scheme;
  try {
    scheme = new URL(proxyUrl).protocol;
  } catch {
    throw new FalRealtimeError("This proxy transport does not support Fal WebSockets", 409);
  }
  if (scheme !== "http:" && scheme !== "https:") throw new FalRealtimeError("This proxy transport does not support Fal WebSockets", 409);
  try {
    const agent = agentFactory ? await agentFactory(proxyUrl) : new (await import("https-proxy-agent")).HttpsProxyAgent(proxyUrl);
    if (!agent) throw new Error("no agent");
    return agent;
  } catch {
    throw new FalRealtimeError("Fal WebSocket proxy unavailable", 502);
  }
}

/**
 * Open `url` with the selected key and resolve once the socket is open.
 *
 * @param {object} args
 * @param {string} args.url - a `wss://fal.run/...` URL (checked by the caller)
 * @param {string} args.token - the selected connection key; sent only as a header
 * @param {AbortSignal} [args.signal]
 * @param {(data: Uint8Array) => {event: string, data: unknown}} args.onFrame - maps one inbound frame
 * @param {() => void} [args.onClose] - called once when the session ends
 * @param {string|null} [args.proxyUrl]
 * @param {Function} [args.agentFactory]
 * @param {Function} [args.socketFactory] - `(url, options) => ws-like socket`
 * @param {object} [args.limits] - overrides of FAL_REALTIME_LIMITS
 */
export async function openFalRealtimeSocket({ url, token, signal, onFrame, onClose, proxyUrl = null, agentFactory, socketFactory, limits: overrides }) {
  const limits = { ...FAL_REALTIME_LIMITS, ...overrides };
  if (signal?.aborted) throw new FalRealtimeError("Fal WebSocket aborted", 499);
  const agent = await proxyAgent(proxyUrl, agentFactory);
  if (signal?.aborted) throw new FalRealtimeError("Fal WebSocket aborted", 499);

  const options = {
    headers: { Authorization: `Key ${token}` },
    followRedirects: false,
    handshakeTimeout: limits.handshakeTimeoutMs,
    maxPayload: limits.maxFrameBytes,
    ...(agent ? { agent } : {}),
  };
  const socket = (socketFactory ?? ((target, opts) => new WebSocket(target, opts)))(url, options);

  let controller;
  let closed = false;
  let opened = false;
  let sent = 0;
  let received = 0;
  let idleTimer = null;
  let settle = null;
  const output = new ReadableStream(
    {
      start: (c) => { controller = c; },
      pull: () => { if (!closed) socket.resume?.(); },
      cancel: () => close(),
    },
    { highWaterMark: limits.outputHighWaterBytes, size: (chunk) => chunk.byteLength },
  );

  // A submission is uncertain while an input went out with no output for it.
  const uncertain = () => opened && sent > received;

  const emit = (event, data, terminal = false) => {
    if (closed) return;
    controller.enqueue(falRealtimeSseEvent(event, data));
    const desired = controller.desiredSize ?? 0;
    if (!terminal && limits.outputHighWaterBytes - desired > limits.maxQueuedOutputBytes) {
      fail("Fal realtime output queue is full");
      return;
    }
    if (desired <= 0) socket.pause?.();
  };

  const armIdle = () => {
    clearTimeout(idleTimer);
    if (!closed && opened && limits.idleTimeoutMs > 0) {
      idleTimer = setTimeout(() => fail("Fal realtime session was idle too long", "idle"), limits.idleTimeoutMs);
      idleTimer.unref?.();
    }
  };

  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(idleTimer);
    signal?.removeEventListener("abort", onAbort);
    try { socket.terminate?.(); } catch { /* already gone */ }
    try { controller.close(); } catch { /* a cancelled stream is already closed */ }
    settle?.(new FalRealtimeError("Fal WebSocket connection closed", 502));
    onClose?.();
  }

  function fail(message, reason = "error") {
    if (closed) return;
    if (!opened) settle?.(new FalRealtimeError(message, 502));
    emit("error", { error: message, status: uncertain() ? "SUBMISSION_UNKNOWN" : reason === "idle" ? "IDLE_TIMEOUT" : "FAILED" }, true);
    close();
  }

  function onAbort() {
    if (uncertain()) emit("error", { error: "Fal WebSocket stopped; upstream completion is unknown", status: "SUBMISSION_UNKNOWN" }, true);
    close();
  }

  socket.on("message", (data, isBinary) => {
    if (closed) return;
    const bytes = Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > limits.maxFrameBytes) {
      fail("Invalid fal realtime output");
      return;
    }
    let mapped;
    try {
      mapped = onFrame(bytes, isBinary);
    } catch {
      fail("Invalid fal realtime output");
      return;
    }
    received++;
    armIdle();
    emit(mapped.event, mapped.data);
  });
  socket.on("error", () => fail("Fal WebSocket connection failed"));
  socket.once("close", () => {
    if (uncertain()) emit("error", { error: "Fal connection lost", status: "SUBMISSION_UNKNOWN" }, true);
    close();
  });
  signal?.addEventListener("abort", onAbort, { once: true });

  await new Promise((resolve, reject) => {
    const handshake = setTimeout(() => {
      settle = null;
      reject(new FalRealtimeError("Fal WebSocket handshake timed out", 504));
      close();
    }, limits.handshakeTimeoutMs);
    handshake.unref?.();
    settle = (error) => { clearTimeout(handshake); settle = null; reject(signal?.aborted ? new FalRealtimeError("Fal WebSocket aborted", 499) : error); };
    socket.once("open", () => {
      clearTimeout(handshake);
      if (!settle) return;
      settle = null;
      opened = true;
      armIdle();
      resolve();
    });
    if (signal?.aborted) close();
  });

  return {
    output,
    close,
    get closed() { return closed; },
    /** Send one encoded frame; throws 410 after close and 429 when the send buffer is full. */
    send(frame) {
      if (closed || socket.readyState !== OPEN) throw new FalRealtimeError("Fal WebSocket session has ended or expired", 410);
      if (frame.byteLength > limits.maxInputBytes) throw new FalRealtimeError("Fal realtime input is too large", 413);
      if ((socket.bufferedAmount ?? 0) > limits.maxSendBufferBytes) throw new FalRealtimeError("Fal WebSocket send buffer is full", 429);
      sent++;
      armIdle();
      socket.send(frame, { binary: true }, (error) => {
        if (error) fail("Fal WebSocket submission is uncertain");
      });
    },
  };
}

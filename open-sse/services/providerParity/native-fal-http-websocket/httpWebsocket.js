// Native fal HTTP over WebSockets: one `wss://ws.fal.run/{endpoint}` session
// per call, JSON input in text frames, HTTP-shaped replies (start, raw body,
// end), the selected connection's key kept server-side. Staged and NOT
// registered (see ./registration.json). This is fal's own protocol, not the
// MessagePack realtime transport and not OpenAI Realtime.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/fal/httpWebsocket.ts (connectFalHttpWebsocket: the socket
// URL is `wss://ws.fal.run/{canonicalFalEndpoint(endpoint)}`; `send(input)`
// writes `JSON.stringify(input)` as one text frame, refuses a second input
// while one is pending with 409, and arms the invocation deadline; any reply
// violation fails the session with "Invalid or oversized Fal HTTP WebSocket
// response"; onClose reports whether an invocation was still pending),
// open-sse/handlers/fal/socket.ts (FalSocket: `Authorization: Key <token>`
// on the upgrade only, followRedirects false, 15 s handshake, 32 MiB
// maxPayload, HTTP(S) proxy only else 409, SSE output with pause/resume
// backpressure, SUBMISSION_UNKNOWN on abort/close/failure while uncertain,
// 410 after close, 429 past a 1 MiB send buffer, close runs once and never
// reconnects or replays) and src/lib/fal/dispatch.ts (the proxy is resolved
// for https://ws.fal.run; the input is validated with the direct HTTP schema;
// binary bodies go to the artifact store).
//
// Fork deviations, all matching the staged realtime bundle: a local
// handshake deadline; an abort before open rejects with 499 (source 504); an
// error with no invocation pending is FAILED, not SUBMISSION_UNKNOWN; an idle
// timer closes a session with no pending invocation after `idleTimeoutMs`;
// queued output beyond `maxQueuedOutputBytes` fails the session; inputs are
// validated inside `send` and capped at `maxInputBytes` (413); every error is
// a fixed message with no upstream text, URL or key.
import { WebSocket } from "ws";
import { isFunction, isRecord } from "../../../../src/shared/utils/typeChecks.js";
import { FalRealtimeError } from "../native-fal-realtime/schema.js";
import { falRealtimeToken } from "../native-fal-realtime/realtime.js";
import { falRealtimeSseEvent } from "../native-fal-realtime/socket.js";
import { FAL_HTTP_WEBSOCKET_LIMITS, FAL_HTTP_WEBSOCKET_ORIGIN } from "./config.js";
import { canonicalFalEndpoint, falHttpWebsocketUrl } from "./endpoint.js";
import { FalHttpWebsocketReply } from "./reply.js";
import { compileFalHttpWebsocketInput } from "./schema.js";

const OPEN = 1;
const INVALID_REPLY = "Invalid or oversized Fal HTTP WebSocket response";

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

function frameBytes(data) {
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return data instanceof Uint8Array ? data : null;
}

/**
 * Open one fal HTTP-WebSocket session for an endpoint definition with the
 * selected connection's key. Each `send` is one HTTP invocation; the next
 * one is accepted only after the previous `end`.
 *
 * @param {object} args
 * @param {{ endpoint_id: string, openapi: object }} args.definition - endpoint id or legacy alias plus its OpenAPI document
 * @param {{ apiKey?: string, accessToken?: string }} args.credentials - the selected connection
 * @param {AbortSignal} [args.signal]
 * @param {(uncertain: boolean) => void} [args.onClose] - once; `true` when an invocation was pending
 * @param {(bytes: Uint8Array, type: string, name: string) => string} [args.artifact] - stores binary bodies, returns their URL
 * @param {string|null} [args.proxyUrl] - HTTP(S) proxy resolved for https://ws.fal.run; others are refused (409)
 * @param {Function} [args.agentFactory]
 * @param {Function} [args.socketFactory] - `(url, options) => ws-like socket`; tests use synthetic sockets
 * @param {object} [args.limits] - overrides of FAL_HTTP_WEBSOCKET_LIMITS
 * @returns {Promise<{ output: ReadableStream<Uint8Array>, send(input: object): void, close(): void, endpoint: string, readonly closed: boolean, readonly pending: boolean }>}
 * @throws {FalRealtimeError} with an HTTP `status`, before any socket for 400/401/409
 */
export async function connectFalHttpWebsocket({ definition, credentials, signal, onClose, artifact, proxyUrl = null, agentFactory, socketFactory, limits: overrides }) {
  const limits = { ...FAL_HTTP_WEBSOCKET_LIMITS, ...overrides };
  if (!isRecord(definition)) throw new FalRealtimeError("A fal definition needs an OpenAPI document", 400);
  const endpoint = canonicalFalEndpoint(definition.endpoint_id);
  const url = falHttpWebsocketUrl(endpoint);
  if (!url.startsWith(`${FAL_HTTP_WEBSOCKET_ORIGIN}/`)) throw new FalRealtimeError("Invalid fal endpoint", 400);
  const validate = compileFalHttpWebsocketInput(definition);
  const token = falRealtimeToken(credentials);
  if (!token) throw new FalRealtimeError("Fal API key is required", 401);
  if (artifact !== undefined && !isFunction(artifact)) throw new FalRealtimeError("Invalid fal artifact store", 500);
  if (signal?.aborted) throw new FalRealtimeError("Fal WebSocket aborted", 499);
  const agent = await proxyAgent(proxyUrl, agentFactory);
  if (signal?.aborted) throw new FalRealtimeError("Fal WebSocket aborted", 499);

  const options = {
    headers: { Authorization: `Key ${token}` },
    followRedirects: false,
    handshakeTimeout: limits.handshakeTimeoutMs,
    maxPayload: limits.maxFrameBytes,
  };
  if (agent) options.agent = agent;
  let socket;
  try {
    socket = (socketFactory ?? ((target, opts) => new WebSocket(target, opts)))(url, options);
  } catch {
    throw new FalRealtimeError("Fal WebSocket connection failed", 502);
  }

  let controller;
  let closed = false;
  let opened = false;
  let idleTimer = null;
  let invocationTimer = null;
  let settle = null;
  const output = new ReadableStream(
    {
      start: (c) => { controller = c; },
      pull: () => { if (!closed) socket.resume?.(); },
      cancel: () => close(),
    },
    { highWaterMark: limits.outputHighWaterBytes, size: (chunk) => chunk.byteLength },
  );

  const emit = (event, data, terminal = false) => {
    if (closed) return;
    controller.enqueue(falRealtimeSseEvent(event, data));
    const desired = controller.desiredSize ?? 0;
    if (!terminal && limits.outputHighWaterBytes - desired > limits.maxQueuedOutputBytes) {
      fail("Fal HTTP WebSocket output queue is full");
      return;
    }
    if (desired <= 0) socket.pause?.();
  };

  const armIdle = () => {
    clearTimeout(idleTimer);
    if (!closed && opened && !reply.pending && limits.idleTimeoutMs > 0) {
      idleTimer = setTimeout(() => fail("Fal HTTP WebSocket session was idle too long", "idle"), limits.idleTimeoutMs);
      idleTimer.unref?.();
    }
  };

  const reply = new FalHttpWebsocketReply(
    (event, data) => emit(event, data),
    artifact,
    () => {
      clearTimeout(invocationTimer);
      armIdle();
    },
    limits,
  );

  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(idleTimer);
    clearTimeout(invocationTimer);
    signal?.removeEventListener("abort", onAbort);
    try { socket.terminate?.(); } catch { /* already gone */ }
    try { controller.close(); } catch { /* a cancelled stream is already closed */ }
    settle?.(new FalRealtimeError("Fal WebSocket connection closed", 502));
    const uncertain = reply.pending;
    reply.dispose();
    onClose?.(uncertain);
  }

  function fail(message, reason = "error") {
    if (closed) return;
    if (!opened) settle?.(new FalRealtimeError(message, 502));
    let status = "FAILED";
    if (reply.pending) status = "SUBMISSION_UNKNOWN";
    else if (reason === "idle") status = "IDLE_TIMEOUT";
    emit("error", { error: message, status }, true);
    close();
  }

  function onAbort() {
    if (reply.pending) emit("error", { error: "Fal WebSocket stopped; upstream completion is unknown", status: "SUBMISSION_UNKNOWN" }, true);
    close();
  }

  socket.on("message", (data, isBinary) => {
    if (closed) return;
    const bytes = frameBytes(data);
    if (!bytes || bytes.byteLength > limits.maxFrameBytes) {
      fail(INVALID_REPLY);
      return;
    }
    try {
      reply.consume(bytes, isBinary === true);
    } catch {
      fail(INVALID_REPLY);
    }
  });
  socket.on("error", () => fail("Fal WebSocket connection failed"));
  socket.once("close", () => {
    if (reply.pending) emit("error", { error: "Fal connection lost", status: "SUBMISSION_UNKNOWN" }, true);
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
    endpoint,
    output,
    close,
    get closed() { return closed; },
    get pending() { return reply.pending; },
    /** Validate and send one HTTP input; throws 400/409/410/413/429 without sending. */
    send(input) {
      if (closed || socket.readyState !== OPEN) throw new FalRealtimeError("Fal WebSocket session has ended or expired", 410);
      if (reply.pending) throw new FalRealtimeError("The previous Fal invocation has not ended", 409);
      let text;
      try {
        text = JSON.stringify(validate(input));
      } catch (error) {
        if (error instanceof FalRealtimeError) throw error;
        throw new FalRealtimeError("Invalid fal input: not encodable", 400);
      }
      if (Buffer.byteLength(text, "utf8") > limits.maxInputBytes) throw new FalRealtimeError("Fal HTTP WebSocket input is too large", 413);
      if ((socket.bufferedAmount ?? 0) > limits.maxSendBufferBytes) throw new FalRealtimeError("Fal WebSocket send buffer is full", 429);
      reply.pending = true;
      clearTimeout(idleTimer);
      invocationTimer = setTimeout(() => fail("Fal HTTP WebSocket invocation timed out"), limits.invocationTimeoutMs);
      invocationTimer.unref?.();
      try {
        socket.send(text, { binary: false }, (error) => {
          if (error) fail("Fal WebSocket submission is uncertain");
        });
      } catch {
        reply.pending = false;
        clearTimeout(invocationTimer);
        armIdle();
        throw new FalRealtimeError("Fal WebSocket send failed", 502);
      }
    },
  };
}

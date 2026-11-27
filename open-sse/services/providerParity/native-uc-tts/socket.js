// UC TTS WebSocket driver. Port of OmniRoute c71f0065
// open-sse/handlers/uc/ucTts.ts (buildUcTtsWsUrl, buildUcTtsStartFrame,
// runUcTtsSocket):
//
//   wss://tts-stream.chatuncensored.ai/{uid}?token={jwt}
//   upgrade header: Origin: https://uncensored.com   (no Cookie, no Authorization)
//   SEND one frame { message_type: "start", text, raw_text, turn_anchor_message_id,
//                    message_id, thread_id, threadId, model, voice, token }
//   RECV { type: "usage_update", usage_percent, threshold_crossed }   quota, tracked
//        { data: "<base64 MP3 chunk>" }                              audio
//        (frames one per message or newline-delimited; the socket closes when done)
//
// Fork deviations: redirects are never followed; per-frame and total byte
// caps; a handshake deadline, an idle deadline between frames and a total
// deadline; a chunk that is not strict base64 fails the call instead of being
// half-decoded; a close other than 1000/1005 after audio is a truncated
// result, not a success; the result says whether the start frame left, so
// the caller can mark uncertain accepted work and never replay it.
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { isFunction, isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  UC_HANDSHAKE_TIMEOUT_MS, UC_IDLE_TIMEOUT_MS, UC_MAX_AUDIO_BYTES, UC_MAX_FRAME_BYTES, UC_ORIGIN,
  UC_TTS_DEFAULT_MODEL, UC_TTS_TOTAL_TIMEOUT_MS, UC_TTS_WS_HOST,
} from "./config.js";

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const CLEAN_CLOSE = new Set([1000, 1005]);

let WebSocketCtor = WebSocket;
/** Swap the WebSocket constructor (tests). Returns a restore function. */
export function __setUcTtsWebSocketForTesting(ctor) {
  const previous = WebSocketCtor;
  WebSocketCtor = ctor;
  return () => {
    WebSocketCtor = previous;
  };
}

export const buildUcTtsWsUrl = (uid, jwt) => `${UC_TTS_WS_HOST}/${encodeURIComponent(uid)}?token=${encodeURIComponent(jwt)}`;

/** Source start frame; the JWT is echoed inside the body as `token`. */
export function buildUcTtsStartFrame({ text, voice, jwt, model }) {
  const threadId = randomUUID();
  return {
    message_type: "start",
    text,
    raw_text: text,
    turn_anchor_message_id: randomUUID(),
    message_id: randomUUID(),
    thread_id: threadId,
    threadId,
    model: model ?? UC_TTS_DEFAULT_MODEL,
    voice,
    token: jwt,
  };
}

function frameText(data) {
  if (isString(data)) return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  return "";
}
const frameBytes = (data) => (isString(data) ? Buffer.byteLength(data) : data?.byteLength ?? 0);

/**
 * Drive one synthesis. Never rejects. Resolves
 * `{ outcome, sent, audio, usagePercent?, thresholdCrossed?, handshakeStatus? }`
 * where outcome is one of complete | empty | aborted | timeout | idle |
 * handshake | connect | error | abnormal-close | malformed | too-large.
 * `sent` is true once the start frame was handed to the socket.
 */
export function runUcTtsSocket({
  url, frame, signal, agent = null,
  timeoutMs = UC_TTS_TOTAL_TIMEOUT_MS, handshakeTimeoutMs = UC_HANDSHAKE_TIMEOUT_MS, idleTimeoutMs = UC_IDLE_TIMEOUT_MS,
  maxFrameBytes = UC_MAX_FRAME_BYTES, maxAudioBytes = UC_MAX_AUDIO_BYTES, WebSocketImpl = WebSocketCtor,
}) {
  return new Promise((resolve) => {
    const chunks = [];
    let audioBytes = 0;
    let sent = false;
    let usagePercent;
    let thresholdCrossed;
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
        if (outcome === "complete" || outcome === "empty") ws?.close?.();
        else if (isFunction(ws?.terminate)) ws.terminate();
        else ws?.close?.();
      } catch {
        /* already closed */
      }
      resolve({
        outcome, sent, audio: Buffer.concat(chunks),
        ...(usagePercent !== undefined ? { usagePercent } : null),
        ...(thresholdCrossed !== undefined ? { thresholdCrossed } : null),
        ...extra,
      });
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
        perMessageDeflate: false,
        ...(agent ? { agent } : null),
      });
    } catch {
      return finish("connect");
    }

    // ws emits this for a non-101 answer (including any redirect); nothing was sent.
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
        sent = true;
      } catch {
        finish("error");
      }
    };

    ws.onmessage = (event) => {
      if (settled) return;
      arm("idle", idleTimeoutMs, "idle");
      if (frameBytes(event?.data) > maxFrameBytes) return finish("too-large");
      const raw = frameText(event?.data);
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let parsed;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          continue; // Source skips unparseable lines.
        }
        if (!isRecord(parsed)) continue;
        if (parsed.type === "usage_update") {
          if (isNumber(parsed.usage_percent) && Number.isFinite(parsed.usage_percent)) usagePercent = parsed.usage_percent;
          if (typeof parsed.threshold_crossed === "boolean") thresholdCrossed = parsed.threshold_crossed;
          continue;
        }
        if (!isString(parsed.data) || !parsed.data) continue;
        if (!BASE64.test(parsed.data)) return finish("malformed");
        const bytes = Buffer.from(parsed.data, "base64");
        audioBytes += bytes.length;
        if (audioBytes > maxAudioBytes) return finish("too-large");
        chunks.push(bytes);
      }
    };

    ws.onerror = () => finish(sent ? "error" : "connect");
    ws.onclose = (event) => {
      if (settled) return;
      if (!sent) return finish("connect");
      const code = event?.code;
      if (audioBytes === 0) return finish("empty", { closeCode: code });
      return finish(CLEAN_CLOSE.has(code) ? "complete" : "abnormal-close", { closeCode: code });
    };
  });
}

// Gemini Live WebSocket driver for one file-mode transcription session.
// Port of OmniRoute c71f0065 open-sse/executors/geminiLiveTranscribe.ts
// (GeminiLiveSession): open -> setup frame -> setupComplete -> stream PCM
// frames -> audioStreamEnd -> collect serverContent.inputTranscription.text
// -> finish 250 ms after turnComplete/generationComplete, after a 5 s grace
// when none arrives, or on a close after audioStreamEnd. snake_case aliases
// (setup_complete, server_content, input_transcription, turn_complete,
// generation_complete) are accepted as in the source; non-JSON frames are
// ignored as in the source.
//
// Fork deviations: credentials only in the upgrade headers of a fixed URL;
// redirects are never followed (a non-101 answer, 3xx included, ends the
// session before anything is sent); handshake, setup and total deadlines;
// caller abort terminates the socket at any point (the source only stopped
// ffmpeg); per-frame and transcript byte caps; an in-band `error` frame and a
// close are classified without keeping upstream text; a close with a
// non-normal code after audioStreamEnd and before turnComplete is a lost
// result, not a success; usageMetadata frames are kept for accounting. The
// result says whether any audio left, so the caller can mark uncertain
// accepted work and never replay it.
import { Buffer } from "node:buffer";
import WebSocket from "ws";
import { isFunction, isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  GEMINI_LIVE_BACKPRESSURE_BYTES, GEMINI_LIVE_HANDSHAKE_TIMEOUT_MS, GEMINI_LIVE_MAX_FRAME_BYTES,
  GEMINI_LIVE_MAX_TRANSCRIPT_BYTES, GEMINI_LIVE_SETUP_TIMEOUT_MS, GEMINI_LIVE_STREAM_END_GRACE_MS,
  GEMINI_LIVE_TOTAL_TIMEOUT_MS, GEMINI_LIVE_TURN_COMPLETE_SETTLE_MS,
} from "./config.js";
import { GEMINI_LIVE_AUDIO_END_FRAME, geminiLiveAudioFrames } from "./request.js";

const CLEAN_CLOSE = new Set([1000, 1005]);
const QUOTA_TEXT = /quota|resource[_ ]?exhausted|rate.?limit/i;
const OPEN = 1;

function frameText(data) {
  if (isString(data)) return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  return "";
}
const frameBytes = (data) => {
  if (isString(data)) return Buffer.byteLength(data);
  if (Array.isArray(data)) return data.reduce((sum, part) => sum + (part?.byteLength ?? 0), 0);
  return data?.byteLength ?? 0;
};
const turnComplete = (content) => Boolean(content.turnComplete || content.turn_complete || content.generationComplete || content.generation_complete);
const reasonText = (reason) => (isString(reason) ? reason : Buffer.isBuffer(reason) ? reason.toString("utf8") : "");

/**
 * Drive one Live transcription. Never rejects. Resolves
 * `{ outcome, sent, setupSent, text, usage?, ... }` where outcome is one of
 * complete | aborted | timeout | setup-timeout | handshake | connect | error |
 * upstream-error | closed | abnormal-close | too-large.
 * `sent` is true once the first audio frame was handed to the socket (the
 * point after which Gemini may bill); `setupSent` once the setup frame left.
 */
export function runGeminiLiveSocket({
  url, headers, setup, pcm, signal, agent = null, WebSocketImpl = WebSocket,
  timeoutMs = GEMINI_LIVE_TOTAL_TIMEOUT_MS, handshakeTimeoutMs = GEMINI_LIVE_HANDSHAKE_TIMEOUT_MS,
  setupTimeoutMs = GEMINI_LIVE_SETUP_TIMEOUT_MS, graceMs = GEMINI_LIVE_STREAM_END_GRACE_MS,
  settleMs = GEMINI_LIVE_TURN_COMPLETE_SETTLE_MS, maxFrameBytes = GEMINI_LIVE_MAX_FRAME_BYTES,
  maxTranscriptBytes = GEMINI_LIVE_MAX_TRANSCRIPT_BYTES, backpressureBytes = GEMINI_LIVE_BACKPRESSURE_BYTES,
}) {
  return new Promise((resolve) => {
    const transcripts = [];
    let transcriptBytes = 0;
    let usage = null;
    let sent = false;
    let setupSent = false;
    let streaming = false;
    let audioEnded = false;
    let sawTurnComplete = false;
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
        if (outcome === "complete") ws?.close?.(1000);
        else if (isFunction(ws?.terminate)) ws.terminate();
        else ws?.close?.();
      } catch {
        /* already closed */
      }
      resolve({
        outcome, sent, setupSent, audioEnded, turnComplete: sawTurnComplete,
        text: transcripts.map((t) => t.trim()).filter(Boolean).join(" ").trim(),
        ...(usage ? { usage } : null),
        ...extra,
      });
    };
    const arm = (name, ms, fn) => {
      clear(name);
      timers[name] = setTimeout(fn, Math.max(0, ms));
    };
    const onAbort = () => finish("aborted");
    if (signal?.aborted) return finish("aborted");
    signal?.addEventListener("abort", onAbort, { once: true });
    arm("total", timeoutMs, () => finish("timeout"));
    arm("handshake", handshakeTimeoutMs, () => finish("timeout", { phase: "handshake" }));

    try {
      ws = new WebSocketImpl(url, {
        headers,
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
    const isOpen = () => ws.readyState === (isNumber(ws.OPEN) ? ws.OPEN : OPEN);

    // ws emits this for any non-101 answer, redirects included; nothing was sent.
    if (isFunction(ws.on)) {
      ws.on("unexpected-response", (_request, response) => {
        const status = response?.statusCode;
        response?.resume?.();
        finish("handshake", { handshakeStatus: isNumber(status) ? status : 0, retryAfter: response?.headers?.["retry-after"] ?? null });
      });
    }

    const scheduleFinish = (delay, completion) => arm("finish", delay, () => finish("complete", { completion }));

    async function streamAudio() {
      try {
        for (const frame of geminiLiveAudioFrames(pcm)) {
          if (settled) return;
          if (!isOpen()) return finish(sent ? "abnormal-close" : "closed", { phase: "streaming" });
          ws.send(JSON.stringify(frame));
          sent = true;
          while (!settled && (ws.bufferedAmount ?? 0) > backpressureBytes) await new Promise((r) => setTimeout(r, 15));
        }
        if (settled) return;
        if (!isOpen()) return finish("abnormal-close", { phase: "streaming" });
        ws.send(JSON.stringify(GEMINI_LIVE_AUDIO_END_FRAME));
        audioEnded = true;
        scheduleFinish(graceMs, "grace");
      } catch {
        finish("error");
      }
    }

    function onServerMessage(data) {
      if (isRecord(data.error)) {
        const code = isNumber(data.error.code) ? data.error.code : null;
        const status = isString(data.error.status) ? data.error.status : "";
        const quota = code === 429 || QUOTA_TEXT.test(status) || QUOTA_TEXT.test(isString(data.error.message) ? data.error.message : "");
        return finish("upstream-error", { upstreamCode: code, quota });
      }
      if (isRecord(data.usageMetadata)) usage = data.usageMetadata;
      if (data.setupComplete || data.setup_complete) {
        if (streaming) return;
        streaming = true;
        clear("setup");
        void streamAudio();
        return;
      }
      const content = isRecord(data.serverContent) ? data.serverContent : isRecord(data.server_content) ? data.server_content : null;
      if (!content) return;
      const input = isRecord(content.inputTranscription) ? content.inputTranscription : isRecord(content.input_transcription) ? content.input_transcription : null;
      if (input && isString(input.text) && input.text) {
        transcriptBytes += Buffer.byteLength(input.text);
        if (transcriptBytes > maxTranscriptBytes) return finish("too-large");
        transcripts.push(input.text);
      }
      if (turnComplete(content) && audioEnded) {
        sawTurnComplete = true;
        scheduleFinish(settleMs, "turn-complete");
      }
    }

    ws.onopen = () => {
      if (settled) return;
      clear("handshake");
      try {
        ws.send(JSON.stringify(setup));
        setupSent = true;
      } catch {
        return finish("error");
      }
      arm("setup", setupTimeoutMs, () => finish("setup-timeout"));
    };

    ws.onmessage = (event) => {
      if (settled) return;
      if (frameBytes(event?.data) > maxFrameBytes) return finish("too-large");
      let data;
      try {
        data = JSON.parse(frameText(event?.data));
      } catch {
        return; // Source ignores non-JSON frames.
      }
      if (isRecord(data)) onServerMessage(data);
    };

    ws.onerror = () => finish(setupSent ? "error" : "connect");
    ws.onclose = (event) => {
      if (settled) return;
      const code = isNumber(event?.code) ? event.code : 1006;
      if (audioEnded) {
        // Source: a close after audioStreamEnd finishes with what was collected.
        if (sawTurnComplete || CLEAN_CLOSE.has(code)) return finish("complete", { completion: "close", closeCode: code });
        return finish("abnormal-close", { closeCode: code });
      }
      if (!setupSent) return finish("connect", { closeCode: code });
      const quota = code === 4429 || QUOTA_TEXT.test(reasonText(event?.reason));
      return finish(sent ? "abnormal-close" : "closed", { closeCode: code, quota });
    };
  });
}

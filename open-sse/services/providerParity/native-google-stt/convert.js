// Uploaded-audio conversion for the staged Gemini Live transcription (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/executors/geminiLiveTranscribe.ts convertToPcm16k /
// runFfmpegPcm16k. The source keeps the WAV fast path
// (extractPcmFrom16kWav), otherwise pipes the upload into
// `ffmpeg -nostdin -hide_banner -loglevel error -protocol_whitelist pipe
// -threads 1 -i pipe:0 -vn -t 600 -f s16le -acodec pcm_s16le -ac 1 -ar 16000
// pipe:1`, with a 60 s wall clock, an 8 KiB stderr cap, a decoded-PCM cap, and
// SIGKILL on timeout, abort or overflow. Conversion runs before the socket is
// resolved or dialed (geminiLiveTranscribe).
//
// The existing local helper (open-sse/handlers/codexSttAudio.js) writes the
// upload to a temp file, allows the `file` protocol, looks ffmpeg up on PATH
// and passes the full server environment to the child, so it is not reused.
//
// Fork deviations, all stricter than the source:
// - The executable is a fixed absolute path (first executable entry of
//   GEMINI_LIVE_FFMPEG_CANDIDATES), never a PATH lookup or caller value.
// - The container is sniffed from magic bytes and only a fixed table of
//   demuxers is used; the demuxer is forced with `-f` and is the only entry of
//   `-format_whitelist`, so playlists, concat scripts and URLs never reach a
//   demuxer that could open another resource. The upload's filename and
//   content type are ignored.
// - The child gets a fixed, credential-free environment, a fixed cwd, no
//   shell, and stdin/stdout/stderr pipes only; no file is written.
// - Audio longer than 600 s is refused (413) instead of silently cut.
// - ffmpeg's stderr is bounded and never surfaced (it can echo input).
// - Every failure is a local error result (never an account fault) and the
//   child is killed and reaped, with its pipes destroyed, before returning.
import { Buffer } from "node:buffer";
import { spawn as nodeSpawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access as fsAccess } from "node:fs/promises";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { isFunction } from "../../../../src/shared/utils/typeChecks.js";
import { GEMINI_LIVE_MAX_AUDIO_SECONDS, GEMINI_LIVE_MAX_INPUT_BYTES, GEMINI_LIVE_MAX_PCM_BYTES } from "./config.js";
import { extractPcmFrom16kWav, invalid } from "./request.js";

/** Trusted install locations, checked in order. No PATH lookup. */
export const GEMINI_LIVE_FFMPEG_CANDIDATES = Object.freeze(["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg"]);
/** Source GEMINI_LIVE_FFMPEG_TIMEOUT_MS. */
export const GEMINI_LIVE_FFMPEG_TIMEOUT_MS = 60_000;
/** Source FFMPEG_STDERR_MAX_BYTES. */
export const GEMINI_LIVE_FFMPEG_STDERR_MAX_BYTES = 8 * 1024;
/** Time allowed for a killed child to be reaped before the result is returned anyway. */
export const GEMINI_LIVE_FFMPEG_REAP_MS = 2_000;
/** The whole child environment. Nothing from process.env is inherited. */
export const GEMINI_LIVE_FFMPEG_ENV = Object.freeze({ LC_ALL: "C", AV_LOG_FORCE_NOCOLOR: "1" });
export const GEMINI_LIVE_FFMPEG_MISSING_MESSAGE =
  "Gemini Live transcription of non-WAV audio needs ffmpeg, which was not found on this server " +
  `(checked ${GEMINI_LIVE_FFMPEG_CANDIDATES.join(", ")}). Install ffmpeg, or upload 16 kHz, 16-bit, mono PCM WAV`;

const CLIENT_CLOSED = 499;

/**
 * Containers the converter accepts, by sniffed magic bytes, mapped to the
 * one ffmpeg demuxer that may read them. Order matters: ADTS AAC and MPEG
 * audio share the 0xFFF sync word.
 */
export const GEMINI_LIVE_UPLOAD_CONTAINERS = Object.freeze({
  wav: "wav", mp3: "mp3", flac: "flac", ogg: "ogg", m4a: "mov", webm: "matroska", aac: "aac",
});

/** Container of an upload by magic bytes, or null. Never reads filename or content type. */
export function sniffGeminiLiveUpload(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return null;
  const ascii = (start, end) => bytes.toString("latin1", start, end);
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "wav";
  if (ascii(0, 4) === "fLaC") return "flac";
  if (ascii(0, 4) === "OggS") return "ogg";
  if (ascii(4, 8) === "ftyp") return "m4a";
  if (bytes.readUInt32BE(0) === 0x1a45dfa3) return "webm";
  if (ascii(0, 3) === "ID3") return "mp3";
  if (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) return "aac";
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) !== 0) return "mp3";
  return null;
}

/**
 * Fixed argv for one container. Only the demuxer name varies, and it comes
 * from GEMINI_LIVE_UPLOAD_CONTAINERS. Output: raw s16le, mono, 16 kHz, first
 * audio stream only, at most 1 s past the limit so an overlong clip is seen.
 */
export function geminiLiveFfmpegArgs(container) {
  const demuxer = GEMINI_LIVE_UPLOAD_CONTAINERS[container];
  if (!demuxer) throw new Error("unsupported container");
  return [
    "-nostdin", "-hide_banner", "-nostats", "-loglevel", "error",
    "-protocol_whitelist", "pipe",
    "-format_whitelist", demuxer,
    "-f", demuxer,
    "-threads", "1",
    "-i", "pipe:0",
    "-map", "0:a:0", "-vn", "-sn", "-dn",
    "-t", String(GEMINI_LIVE_MAX_AUDIO_SECONDS + 1),
    "-threads", "1",
    "-f", "s16le", "-acodec", "pcm_s16le", "-ac", "1", "-ar", "16000",
    "pipe:1",
  ];
}

/** A 44-byte-header RIFF/WAVE around 16 kHz, 16-bit, mono PCM, with exact sizes. */
export function encodePcm16kWav(pcm) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16_000, 24);
  header.writeUInt32LE(32_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** First candidate that is an executable file, or null. */
async function locateFfmpeg(access) {
  for (const candidate of GEMINI_LIVE_FFMPEG_CANDIDATES) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      /* try the next fixed location */
    }
  }
  return null;
}

const missing = () => invalid(GEMINI_LIVE_FFMPEG_MISSING_MESSAGE, HTTP_STATUS.SERVICE_UNAVAILABLE);
const aborted = () => invalid("Gemini Live transcription aborted during audio conversion; no audio was sent", CLIENT_CLOSED);

/** Run one bounded conversion. Resolves `{ pcm }` or a local error result; never rejects. */
function runConversion({ spawn, command, args, input, signal, timeoutMs, maxPcmBytes, reapMs }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        env: { ...GEMINI_LIVE_FFMPEG_ENV },
        cwd: "/",
        shell: false,
        windowsHide: true,
        detached: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      resolve(error?.code === "ENOENT" ? missing() : invalid("Gemini Live audio conversion could not start", HTTP_STATUS.SERVER_ERROR));
      return;
    }
    const chunks = [];
    let size = 0;
    let stderrBytes = 0;
    let outcome = null;
    let closed = false;
    let reapTimer = null;
    let deadline = null;

    const destroyPipes = () => {
      for (const stream of [child.stdin, child.stdout, child.stderr]) {
        try {
          stream?.destroy?.();
        } catch {
          /* already closed */
        }
      }
    };
    const deliver = () => {
      clearTimeout(reapTimer);
      resolve(outcome);
    };
    // First outcome wins. A failure kills the child and returns once it is reaped.
    const settle = (result, { kill = true } = {}) => {
      if (outcome) return;
      outcome = result;
      clearTimeout(deadline);
      signal?.removeEventListener("abort", onAbort);
      if (kill && !closed) {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }
      destroyPipes();
      if (closed) deliver();
      else reapTimer = setTimeout(deliver, reapMs);
    };
    const onAbort = () => settle(aborted());
    signal?.addEventListener("abort", onAbort, { once: true });
    deadline = setTimeout(() => settle(invalid("Gemini Live audio conversion timed out", HTTP_STATUS.GATEWAY_TIMEOUT)), Math.max(1, timeoutMs));

    child.stdout?.on("data", (chunk) => {
      if (outcome) return;
      size += chunk.length;
      if (size > maxPcmBytes) return settle(invalid("Audio exceeds the maximum duration for Gemini Live transcription", HTTP_STATUS.PAYLOAD_TOO_LARGE));
      chunks.push(chunk);
    });
    // Drained and bounded; never surfaced, since ffmpeg can echo input metadata.
    child.stderr?.on("data", (chunk) => {
      stderrBytes = Math.min(GEMINI_LIVE_FFMPEG_STDERR_MAX_BYTES, stderrBytes + chunk.length);
    });
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream?.on?.("error", () => {});
    child.on("error", (error) => {
      if (error?.code === "ENOENT") closed = true; // never started
      settle(error?.code === "ENOENT" ? missing() : invalid("Gemini Live audio conversion failed", HTTP_STATUS.SERVER_ERROR));
    });
    child.on("close", (code) => {
      closed = true;
      if (outcome) return deliver();
      if (code !== 0) return settle(invalid("Gemini Live transcription could not decode the uploaded audio", HTTP_STATUS.BAD_REQUEST), { kill: false });
      const pcm = Buffer.concat(chunks, size);
      if (pcm.length === 0) return settle(invalid("Gemini Live transcription file has no audio samples", HTTP_STATUS.BAD_REQUEST), { kill: false });
      if (pcm.length % 2 !== 0) return settle(invalid("Gemini Live audio conversion produced malformed PCM", HTTP_STATUS.SERVER_ERROR), { kill: false });
      settle({ pcm }, { kill: false });
    });

    if (signal?.aborted) return settle(aborted());
    child.stdin?.end(input);
  });
}

/**
 * Build the converter used by the conversion-enabled adapter. Returns
 * `(bytes, { signal, deadlineAt }) => Promise<{ wav } | error result>`.
 *
 * @param {object} [options]
 * @param {Function} [options.spawn] - child_process.spawn; tests inject a synthetic child
 * @param {Function} [options.access] - fs.promises.access used to find the fixed executable; tests inject it
 * @param {number} [options.timeoutMs] - conversion wall clock (source 60 s), also capped by deadlineAt
 * @param {number} [options.maxInputBytes]
 * @param {number} [options.maxPcmBytes]
 * @param {number} [options.reapMs]
 */
export function createGeminiLiveAudioConverter({
  spawn = nodeSpawn, access = fsAccess, timeoutMs = GEMINI_LIVE_FFMPEG_TIMEOUT_MS,
  maxInputBytes = GEMINI_LIVE_MAX_INPUT_BYTES, maxPcmBytes = GEMINI_LIVE_MAX_PCM_BYTES, reapMs = GEMINI_LIVE_FFMPEG_REAP_MS,
} = {}) {
  return async function convertGeminiLiveAudio(bytes, { signal, deadlineAt = null } = {}) {
    if (signal?.aborted) return aborted();
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) return invalid("Gemini Live transcription file is empty");
    if (bytes.length > maxInputBytes) return invalid("Audio file is too large for Gemini Live transcription", HTTP_STATUS.PAYLOAD_TOO_LARGE);
    const container = sniffGeminiLiveUpload(bytes);
    if (!container) {
      return invalid("Gemini Live transcription accepts WAV, MP3, FLAC, Ogg, M4A, WebM or AAC audio uploads", 415);
    }
    const command = await locateFfmpeg(isFunction(access) ? access : fsAccess);
    if (!command) return missing();
    if (signal?.aborted) return aborted();
    const remaining = Number.isFinite(deadlineAt) ? deadlineAt - Date.now() : timeoutMs;
    if (remaining <= 0) return invalid("Gemini Live audio conversion timed out", HTTP_STATUS.GATEWAY_TIMEOUT);
    const run = await runConversion({
      spawn: isFunction(spawn) ? spawn : nodeSpawn, command, args: geminiLiveFfmpegArgs(container), input: bytes, signal,
      timeoutMs: Math.min(timeoutMs, remaining), maxPcmBytes, reapMs,
    });
    if (!run.pcm) return run;
    const wav = encodePcm16kWav(run.pcm);
    // The framed result must read back as exactly the decoded samples.
    const check = extractPcmFrom16kWav(wav);
    if (!check || check.length !== run.pcm.length) return invalid("Gemini Live audio conversion produced a malformed WAV", HTTP_STATUS.SERVER_ERROR);
    return { wav, container };
  };
}

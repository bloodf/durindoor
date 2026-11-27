// Raw pcm answers from NanoGPT speech (#2034).
//
// NanoGPT documents `pcm` among the response_format values of its OpenAI
// models tts-1 and tts-1-hd, answered as `audio/pcm`
// (https://docs.nano-gpt.com/api-reference/endpoint/speech.md, "Audio Format
// Support by Provider" and "Streaming (`stream: true`)" Content-Type list). The
// pinned OmniRoute source forwards `pcm` unchanged
// (open-sse/handlers/audioSpeech.ts normalizeSpeechResponseFormat).
//
// NanoGPT does not state the sample layout; it names these models as OpenAI's,
// whose speech reference defines pcm as headerless 24 kHz, 16-bit signed
// little-endian, mono samples. That is the layout reported here unless the
// answer's `audio/pcm` type names `rate` or `channels`.
//
// Raw pcm has no signature, so the check is what it cannot be: a typed
// container, a known container's magic bytes, a JSON or HTML document, or a
// byte count that does not end on a whole sample frame.
import { isRecord } from "../../../../src/shared/utils/typeChecks.js";

export const NANOGPT_PCM_DEFAULTS = Object.freeze({ encoding: "s16le", bitsPerSample: 16, sampleRate: 24_000, channels: 1 });
const PCM_TYPES = new Set(["", "audio/pcm", "application/octet-stream", "binary/octet-stream"]);
const MAX_CHANNELS = 8;
const MIN_RATE = 8_000;
const MAX_RATE = 192_000;

const ascii = (bytes, start, text) => bytes.length >= start + text.length && bytes.subarray(start, start + text.length).toString("latin1") === text;
/** Magic bytes of the containers NanoGPT can also return. Frame-sync patterns are left out: pcm samples can match them. */
const CONTAINER_MAGIC = [
  (b) => ascii(b, 0, "ID3"),
  (b) => ascii(b, 0, "OggS"),
  (b) => ascii(b, 0, "fLaC"),
  (b) => ascii(b, 0, "ADIF"),
  (b) => ascii(b, 0, "RIFF") && ascii(b, 8, "WAVE"),
];

/** Whether an answer's media type (lower-cased, no parameters) can carry raw pcm. */
export const pcmTypeAllowed = (type) => PCM_TYPES.has(type);

function looksLikeDocument(bytes) {
  const head = bytes.subarray(0, 64).toString("latin1");
  if (/^\s*<(!doctype|html|\?xml)/i.test(head)) return true;
  if (!/^\s*[{[]/.test(head) || bytes.length > 64 * 1024) return false;
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    return isRecord(value) || Array.isArray(value);
  } catch {
    return false;
  }
}

/** `rate` and `channels` from an `audio/pcm; rate=…; channels=…` type, or an error. */
function layoutFrom(contentType) {
  const layout = { ...NANOGPT_PCM_DEFAULTS, source: "openai-pcm-default" };
  const params = String(contentType ?? "").split(";").slice(1);
  for (const param of params) {
    const [rawName, rawValue = ""] = param.split("=");
    const name = rawName.trim().toLowerCase();
    if (name !== "rate" && name !== "channels") continue;
    const value = rawValue.trim().replace(/^"(.*)"$/, "$1");
    const number = /^\d+$/.test(value) ? Number(value) : NaN;
    if (name === "rate") {
      if (!(number >= MIN_RATE && number <= MAX_RATE)) return { error: "pcm sample rate is malformed" };
      layout.sampleRate = number;
    } else {
      if (!(number >= 1 && number <= MAX_CHANNELS)) return { error: "pcm channel count is malformed" };
      layout.channels = number;
    }
    layout.source = "content-type";
  }
  return { layout };
}

/**
 * Check raw pcm bytes against the answer's content type.
 *
 * @returns {{ pcm: { encoding, bitsPerSample, sampleRate, channels, frames, durationSeconds, source } } | { error: string }}
 */
export function checkNanogptPcm(bytes, contentType) {
  if (!bytes?.length) return { error: "audio was empty" };
  if (CONTAINER_MAGIC.some((check) => check(bytes))) return { error: "audio is a container, not pcm" };
  if (looksLikeDocument(bytes)) return { error: "audio is a document, not pcm" };
  const { layout, error } = layoutFrom(contentType);
  if (error) return { error };
  const frameBytes = (layout.bitsPerSample / 8) * layout.channels;
  if (bytes.length % frameBytes !== 0) return { error: "pcm audio does not end on a whole sample frame" };
  const frames = bytes.length / frameBytes;
  return {
    pcm: Object.freeze({
      encoding: layout.encoding,
      bitsPerSample: layout.bitsPerSample,
      sampleRate: layout.sampleRate,
      channels: layout.channels,
      frames,
      durationSeconds: frames / layout.sampleRate,
      source: layout.source,
    }),
  };
}

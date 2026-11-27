// Qwen Cloud Token Plan native text-to-speech: one JSON POST to the DashScope
// SpeechSynthesizer, answered with inline base64 audio or an expiring audio
// URL that is downloaded without the key. Staged for /v1/audio/speech and not
// registered (see ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/executors/dashscopeTts.ts handleDashscopeTtsSpeech (headers
// `Content-Type: application/json` and `Authorization: Bearer <key>`; body
// exactly `{ model, input: { text, voice }, parameters: { format: "mp3",
// sample_rate: 24000 } }`; `voice` is the trimmed request voice, else
// "longanlingxin"; a JSON `code` is an error even with HTTP 200;
// `output.audio.data` (base64) wins, else `output.audio.url` is downloaded
// through the public-only, DNS-pinned media fetch with a 50 MiB cap; the answer
// is audio/mpeg) and open-sse/config/audioRegistry.ts (`qwen-cloud-token-plan`
// speech row).
//
// Fork deviations: see ./http.js for transport. The source resolves the host
// from the connection's region and honors a custom base URL. The default
// (pinned) adapter sends the key only to the registry's Singapore
// SpeechSynthesizer URL, refuses a connection naming another region and
// ignores a custom base URL. The regional adapter (`regional: true`) sends it
// to the identity's fixed host for the connection's source region
// (global-sg or china-beijing, ../native-dashscope-image/regions.js) and
// refuses an unknown region or a custom base URL before submit.
// Every request field the source would silently drop is refused before submit:
// a response_format other than mp3 (or the json wrapper), streaming, a speed
// other than 1, instructions, a language, a non-string voice, a `model/voice`
// suffix and an oversized request. The upstream error message is never quoted
// (a vendor code of a safe shape is kept). Inline audio must be strict base64;
// a result URL must be https on a public literal host (the integrated Alibaba
// video helper's check, reused read-only) and is fetched with no credential,
// no redirects, the public-only guards, a deadline and the source byte cap.
// The audio must start like an mp3 file.
import { Buffer } from "node:buffer";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { readBounded } from "../../../handlers/codexSttAudio.js";
import { guardedProbeFetch } from "../../../utils/outboundUrlGuard.js";
import { createErrorResult } from "../../../utils/error.js";
import { alibabaVideoResultUrl } from "../../alibabaVideo/job.js";
import { fetchPublic } from "../../../../src/shared/utils/ssrfGuard.js";
import { isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  DASHSCOPE_TTS_DEFAULT_MODEL, DASHSCOPE_TTS_DEFAULT_VOICE, DASHSCOPE_TTS_DOWNLOAD_TIMEOUT_MS, DASHSCOPE_TTS_MAX_AUDIO_BYTES,
  DASHSCOPE_TTS_MAX_ENVELOPE_BYTES, DASHSCOPE_TTS_MAX_REQUEST_BYTES, DASHSCOPE_TTS_MODELS, DASHSCOPE_TTS_PROVIDER_ID,
  DASHSCOPE_TTS_SAMPLE_RATE, DASHSCOPE_TTS_SINGAPORE_REGIONS, DASHSCOPE_TTS_TIMEOUT_MS, DASHSCOPE_TTS_URL, dashscopeTtsModel, dashscopeTtsUrl,
} from "./config.js";
import { resolveDashscopeConnectionRegion } from "../native-dashscope-image/regions.js";
import {
  dashscopeTtsSecrets, dashscopeTtsToken, dashscopeVendorCode, discard, invalid, isUnpaidCode, lostResult, sendOnce, withAcceptedJob,
} from "./http.js";

/** Named formats this adapter honors: mp3 aliases, or the gateway's json wrapper (mp3). */
export const DASHSCOPE_TTS_RESPONSE_FORMATS = Object.freeze(["mp3", "mpeg", "audio/mp3", "audio/mpeg", "json"]);
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const AUDIO_MIME = /^(audio\/[a-z0-9.+-]+|application\/octet-stream|binary\/octet-stream)$/;

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });
const named = (value) => value !== undefined && value !== null && !(isString(value) && !value.trim());

/** "mp3" for a missing format or an mp3 alias (or json), null for anything else. */
export function normalizeDashscopeTtsFormat(format) {
  if (format === undefined || format === null) return "mp3";
  if (!isString(format)) return null;
  return DASHSCOPE_TTS_RESPONSE_FORMATS.includes(format.trim().toLowerCase()) ? "mp3" : null;
}

/** Whether the connection's region (if any) selects the registry's Singapore host. */
export function dashscopeTtsRegionSupported(providerSpecificData) {
  const region = isRecord(providerSpecificData) ? providerSpecificData.region : undefined;
  if (region === undefined || region === null || (isString(region) && !region.trim())) return true;
  return isString(region) && DASHSCOPE_TTS_SINGAPORE_REGIONS.includes(region.trim().toLowerCase());
}

/**
 * The source's SpeechSynthesizer body for an OpenAI-style speech request.
 * Throws a 400 error for an unknown model or any field the source would drop.
 *
 * @param {string} [model] - empty selects qwen-audio-3.0-tts-plus
 * @param {string} text - the speech input
 * @param {object} [options] - the rest of the speech request (voice, speed, ...)
 */
export function buildDashscopeTtsRequest(model, text, options = {}) {
  const modelId = isString(model) && model ? model : DASHSCOPE_TTS_DEFAULT_MODEL;
  if (!dashscopeTtsModel(modelId)) {
    if (modelId.includes("/")) throw reject("DashScope speech takes the voice in the voice field, not a model/voice suffix");
    throw reject(`Unsupported DashScope speech model: ${modelId}. Use one of: ${DASHSCOPE_TTS_MODELS.map((m) => m.id).join(", ")}`);
  }
  if (!isString(text) || !text.trim()) throw reject("DashScope speech needs input text");
  if (options.stream === true || (options.stream_format !== undefined && options.stream_format !== "audio")) {
    throw reject("DashScope speech does not support streaming");
  }
  const speed = options.speed ?? null;
  if (speed !== null && !(isNumber(speed) && speed === 1)) throw reject("DashScope speech does not support speed");
  if (named(options.instructions)) throw reject("DashScope speech does not support instructions");
  if (named(options.language)) throw reject("DashScope speech does not support a language hint");
  let voice = DASHSCOPE_TTS_DEFAULT_VOICE;
  if (named(options.voice)) {
    if (!isString(options.voice)) throw reject("DashScope speech voice must be a string");
    voice = options.voice.trim();
  }
  const request = {
    model: modelId,
    input: { text, voice },
    parameters: { format: "mp3", sample_rate: DASHSCOPE_TTS_SAMPLE_RATE },
  };
  if (Buffer.byteLength(JSON.stringify(request)) > DASHSCOPE_TTS_MAX_REQUEST_BYTES) throw reject("DashScope speech request is too large");
  return request;
}

// True when a response names another origin than the one asked.
function answeredElsewhere(response, url) {
  if (!response.url) return false;
  try {
    return new URL(response.url).origin !== new URL(url).origin;
  } catch {
    return true;
  }
}

/** Whether bytes start like an mp3 file (ID3 tag or an MPEG layer III frame). */
export function isMp3(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true;
  return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) === 0x02;
}

/**
 * Reported usage, once: numeric `*_tokens` fields as tokens and a reported
 * `characters` count as the native unit (DashScope bills speech by characters,
 * with its own counting rules). No price is documented here, so the cost
 * stays unknown and a cost-looking field is never read as a receipt.
 */
export function dashscopeTtsAccounting(data, model) {
  const usage = isRecord(data?.usage) ? data.usage : {};
  const count = (value) => isNumber(value) && Number.isFinite(value) && value >= 0;
  const tokens = Object.fromEntries(Object.entries(usage).filter(([key, value]) => /_tokens$/.test(key) && count(value)));
  const accounting = mediaAccounting(Object.keys(tokens).length ? { usage: tokens } : null, DASHSCOPE_TTS_PROVIDER_ID, "tts");
  if (Number.isInteger(usage.characters) && usage.characters >= 0) accounting.nativeUnits = { characters: usage.characters };
  accounting.meta = {
    ...accounting.meta,
    nativeUnitsSource: accounting.nativeUnits.characters !== undefined ? "provider-usage" : "input-characters",
    model,
    container: "mp3",
  };
  return accounting;
}

/**
 * Download the result audio without any credential: https on a public host
 * only, the public-only URL and connection-time DNS guards, no redirects, a
 * deadline and a byte cap. Every failure is a lost result of produced
 * (billable) speech, so it carries `acceptedJob`; messages are fixed.
 */
export async function downloadDashscopeTtsAudio(url, { signal, fetchImpl, timeoutMs = DASHSCOPE_TTS_DOWNLOAD_TIMEOUT_MS, maxBytes = DASHSCOPE_TTS_MAX_AUDIO_BYTES } = {}) {
  const aborted = () => withAcceptedJob(createErrorResult(499, "DashScope speech request aborted after the audio was produced"), "accepted");
  if (signal?.aborted) return { failure: aborted() };
  const timeout = AbortSignal.timeout(Math.max(1, timeoutMs));
  const fetchSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const fetcher = fetchImpl ?? globalThis.fetch;
  let response;
  try {
    response = await fetchPublic(url, { method: "GET", headers: { Accept: "audio/*" }, signal: fetchSignal }, {
      maxRedirects: 0,
      fetchImpl: (target, init) => guardedProbeFetch(target, init, "public-only", fetcher),
    });
  } catch {
    if (signal?.aborted) return { failure: aborted() };
    return { failure: timeout.aborted ? lostResult("audio download timed out", HTTP_STATUS.GATEWAY_TIMEOUT) : lostResult("audio download was refused or failed") };
  }
  if (response.status !== 200) {
    discard(response);
    return { failure: lostResult(`audio download returned ${response.status}`) };
  }
  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type && !AUDIO_MIME.test(type)) {
    discard(response);
    return { failure: lostResult("audio download is not audio") };
  }
  try {
    return { bytes: await readBounded(response.body, maxBytes, fetchSignal, HTTP_STATUS.BAD_GATEWAY) };
  } catch {
    if (signal?.aborted) return { failure: aborted() };
    return { failure: timeout.aborted ? lostResult("audio download timed out", HTTP_STATUS.GATEWAY_TIMEOUT) : lostResult("audio was unreadable or too large") };
  }
}

/**
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - SpeechSynthesizer transport, proxyAwareFetch by default; tests inject a mock
 * @param {Function} [options.downloadFetchImpl] - result URL transport under the public-only guard, global fetch by default
 * @param {number} [options.timeoutMs] - deadline for the request and its body
 * @param {number} [options.downloadTimeoutMs] - deadline for the result URL download
 * @param {number} [options.maxAudioBytes] - decoded audio cap
 * @param {boolean} [options.regional] - resolve the connection's source region to its fixed host
 */
export function createDashscopeTtsAdapter({
  fetchImpl, downloadFetchImpl, timeoutMs = DASHSCOPE_TTS_TIMEOUT_MS,
  downloadTimeoutMs = DASHSCOPE_TTS_DOWNLOAD_TIMEOUT_MS, maxAudioBytes = DASHSCOPE_TTS_MAX_AUDIO_BYTES,
  regional = false,
} = {}) {
  const maxEnvelopeBytes = Math.min(DASHSCOPE_TTS_MAX_ENVELOPE_BYTES, Math.ceil(maxAudioBytes / 3) * 4 + 64 * 1024);
  return {
    provider: DASHSCOPE_TTS_PROVIDER_ID,
    models: DASHSCOPE_TTS_MODELS,
    responseFormats: DASHSCOPE_TTS_RESPONSE_FORMATS,
    regions: Object.freeze(regional ? ["global-sg", "china-beijing"] : ["global-sg"]),
    /**
     * TTS adapter contract (ttsCore.js): `{ base64, format, accounting }` on
     * success, or a full error result; `local` marks caller input errors and
     * `acceptedJob` marks speech DashScope may have produced and billed.
     */
    async synthesize(text, model, credentials, _responseFormat, options = {}) {
      const { signal } = options;
      const requested = options.requestedResponseFormat ?? options.response_format ?? null;
      if (!normalizeDashscopeTtsFormat(requested)) return invalid("DashScope TTS supports response_format mp3 only");
      let payload;
      try {
        payload = buildDashscopeTtsRequest(model, text, options);
      } catch (error) {
        return invalid(error.message);
      }
      const token = dashscopeTtsToken(credentials);
      if (!token) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "DashScope speech needs a Qwen Cloud Token Plan API key");
      let target = { region: "global-sg", url: DASHSCOPE_TTS_URL };
      if (regional) {
        const bound = resolveDashscopeConnectionRegion(DASHSCOPE_TTS_PROVIDER_ID, credentials);
        if (bound.error) return invalid(`DashScope speech connection ${bound.error}`);
        target = { region: bound.region, url: dashscopeTtsUrl(bound.region) };
      } else if (!dashscopeTtsRegionSupported(credentials?.providerSpecificData)) {
        return invalid("DashScope speech is staged for the Singapore Token Plan host only; this connection names another region");
      }

      const sent = await sendOnce(target.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      }, { credentials, signal, timeoutMs, fetchImpl });
      if (sent.failure) return sent.failure;

      const { response, fetchSignal } = sent;
      if (regional && answeredElsewhere(response, target.url)) {
        sent.clear();
        discard(response);
        return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "DashScope speech was answered by another origin"), "submit-unknown");
      }
      let data = null;
      try {
        let raw;
        try {
          raw = await readBounded(response.body, maxEnvelopeBytes, fetchSignal, HTTP_STATUS.BAD_GATEWAY);
        } catch {
          if (signal?.aborted) return withAcceptedJob(createErrorResult(499, "DashScope speech request aborted after it was sent"), "accepted");
          if (sent.timedOut()) return lostResult("answer did not arrive in time", HTTP_STATUS.GATEWAY_TIMEOUT);
          return lostResult("answer was unreadable or too large");
        }
        try {
          data = JSON.parse(raw.toString("utf8"));
        } catch {
          // The parser's message quotes the body, so it is dropped.
        }
      } finally {
        sent.clear();
      }
      if (!isRecord(data)) return lostResult("answered without a JSON audio payload");

      // Source: a `code` is an error even with HTTP 200; no audio was produced.
      if (data.code !== undefined && data.code !== null && data.code !== "") {
        const code = dashscopeVendorCode(data.code);
        const suffix = code ? ` (${code})` : "";
        if (isUnpaidCode(code)) {
          const failed = createErrorResult(HTTP_STATUS.PAYMENT_REQUIRED, `DashScope refused speech for this account${suffix}`, undefined, undefined, null, dashscopeTtsSecrets(credentials));
          return { ...failed, quotaExhausted: true };
        }
        return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `DashScope speech answered with an error${suffix}`);
      }

      const audio = isRecord(data.output) && isRecord(data.output.audio) ? data.output.audio : {};
      let bytes;
      if (isString(audio.data) && audio.data) {
        if (!BASE64.test(audio.data)) return lostResult("audio was not base64");
        bytes = Buffer.from(audio.data, "base64");
      } else if (isString(audio.url) && audio.url) {
        const url = alibabaVideoResultUrl(audio.url);
        if (!url) return lostResult("audio URL was not https on a public host; it was not fetched");
        const downloaded = await downloadDashscopeTtsAudio(url, { signal, fetchImpl: downloadFetchImpl, timeoutMs: downloadTimeoutMs, maxBytes: maxAudioBytes });
        if (downloaded.failure) return downloaded.failure;
        bytes = downloaded.bytes;
      } else {
        return lostResult("returned no audio");
      }
      if (bytes.length === 0) return lostResult("audio was empty");
      if (bytes.length > maxAudioBytes) return lostResult("audio was unreadable or too large");
      if (!isMp3(bytes)) return lostResult("audio is not an mp3 file");
      const accounting = dashscopeTtsAccounting(data, payload.model);
      if (regional) accounting.meta.region = target.region;
      return { base64: bytes.toString("base64"), format: "mp3", accounting };
    },
  };
}

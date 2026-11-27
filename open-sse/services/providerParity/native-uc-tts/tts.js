// UC native text-to-speech adapter (TTS_ADAPTERS synthesize contract),
// staged and not registered (see ./registration.json). Port of OmniRoute
// c71f0065 open-sse/handlers/audioSpeech.ts (`uc-tts` branch: text from
// `input`, voice from `voice`, start-frame model from the parsed model id,
// audio/mpeg answer) and open-sse/handlers/uc/ucTts.ts handleUcTextToSpeech
// (resolve credential, mint a Clerk JWT, run the socket).
//
// Fork deviations: unsupported inputs (another model, a container other than
// mp3, streaming, speed other than 1, instructions, an unsafe voice, oversize
// text) are refused before the mint; partial audio is never returned as a
// success; a non-MP3 result is refused instead of being labeled audio/mpeg;
// failures after the start frame left carry `acceptedJob` (UC may have
// counted the request against the subscription) and are never retried here.
import { Buffer } from "node:buffer";
import { createErrorResult, parseRateLimitEvidence } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { resolveWebSocketProxyRoute } from "../../../utils/proxyFetch.js";
import { isNumber, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  UC_MAX_INPUT_CHARS, UC_MINT_TIMEOUT_MS, UC_PROVIDER_ID, UC_TTS_DEFAULT_VOICE, UC_TTS_MODELS, UC_TTS_RESPONSE_FORMATS, UC_TTS_TOTAL_TIMEOUT_MS,
  ucTtsModel,
} from "./config.js";
import { resolveUcCredential, ucSecrets } from "./credentials.js";
import { mintUcSessionToken } from "./clerk.js";
import { buildUcTtsStartFrame, buildUcTtsWsUrl, runUcTtsSocket } from "./socket.js";

const MODALITY = "tts";
const VOICE = /^[A-Za-z0-9_-]{1,64}$/;
const CLIENT_CLOSED = 499;

/** Accounting for synthesis UC may have started (and counted) whose outcome is not known. */
export function ucAcceptedJob(jobState = "submit-unknown") {
  return { ...mediaAccounting(null, UC_PROVIDER_ID, MODALITY), costSource: "accepted-job", meta: { jobState } };
}

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });

/**
 * Validate an OpenAI-style speech request against the supported subset.
 * Returns `{ model, voice, text }` or throws a 400 error. No network.
 */
export function buildUcSpeechInput(model, text, options = {}) {
  const modelId = isString(model) && model.startsWith(`${UC_PROVIDER_ID}/`) ? model.slice(UC_PROVIDER_ID.length + 1) : model;
  if (!ucTtsModel(modelId)) throw reject(`Unsupported UC speech model: ${model}. Use one of: ${UC_TTS_MODELS.map((m) => m.id).join(", ")}`);
  if (!isString(text) || !text.trim()) throw reject("UC speech needs input text");
  if ([...text].length > UC_MAX_INPUT_CHARS) throw reject(`UC speech input is limited to ${UC_MAX_INPUT_CHARS} characters`);
  const requested = options.requestedResponseFormat ?? options.response_format ?? null;
  if (requested != null && !UC_TTS_RESPONSE_FORMATS.includes(requested)) throw reject("UC speech returns mp3 audio only; omit response_format or use mp3");
  if (options.stream === true || (options.stream_format != null && options.stream_format !== "audio")) throw reject("UC speech does not support streaming");
  if (options.speed !== undefined && options.speed !== null && !(isNumber(options.speed) && options.speed === 1)) throw reject("UC speech does not support speed");
  if (isString(options.instructions) ? options.instructions.trim() : options.instructions != null) throw reject("UC speech does not support instructions");
  if (options.voice !== undefined && options.voice !== null && !isString(options.voice)) throw reject("UC speech voice must be a string");
  const voice = (isString(options.voice) && options.voice.trim()) || UC_TTS_DEFAULT_VOICE;
  if (!VOICE.test(voice)) throw reject("UC speech voice must be 1-64 letters, digits, '-' or '_'");
  return { model: modelId, voice, text };
}

/** MP3 by magic bytes: an ID3 tag or an MPEG audio frame sync (layer III). */
export function isMp3(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true;
  return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) === 0x02;
}

async function proxyAgent(url, proxyOptions) {
  const route = resolveWebSocketProxyRoute(url, proxyOptions);
  if (!route.enabled || !route.url) return null;
  try {
    const { HttpsProxyAgent } = await import("https-proxy-agent");
    return new HttpsProxyAgent(route.url);
  } catch {
    if (route.strict) throw new Error("WebSocket proxy required but unavailable");
    return null;
  }
}

function rateLimited(message, retryAfter, secrets) {
  const evidence = parseRateLimitEvidence({ status: 429, headers: new Headers({ "retry-after": retryAfter ?? "" }), now: Date.now() });
  const usable = evidence?.source === "retry_after" && Number.isFinite(evidence.resetAtMs) ? evidence : null;
  return createErrorResult(429, message, usable?.resetAtMs, undefined, usable, secrets);
}

function mintFailure(mint, secrets) {
  switch (mint.kind) {
    case "aborted": return createErrorResult(CLIENT_CLOSED, "UC speech request aborted");
    case "timeout": return createErrorResult(HTTP_STATUS.GATEWAY_TIMEOUT, "UC session token request timed out");
    case "redirect": return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "UC session token request was redirected; refused");
    case "foreign": return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "UC session token answer came from an unexpected origin; refused");
    case "malformed": return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "UC session token answer was unreadable");
    case "identity": return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "UC session token belongs to a different account than this connection", undefined, undefined, null, secrets);
    case "status":
      if (mint.status === 401 || mint.status === 403) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "UC refused the session credential; sign in again", undefined, undefined, null, secrets);
      if (mint.status === 429) return rateLimited("UC rate limited the session token request", mint.retryAfter, secrets);
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `UC session token request failed with ${mint.status}`);
    default: return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "UC session token request failed");
  }
}

function socketFailure(run, secrets) {
  const after = (status, message, extra = {}) => ({
    ...createErrorResult(status, message, undefined, undefined, null, secrets),
    ...extra,
    acceptedJob: ucAcceptedJob(run.audio.length > 0 ? "accepted" : "submit-unknown"),
  });
  if (!run.sent) {
    if (run.outcome === "aborted") return createErrorResult(CLIENT_CLOSED, "UC speech request aborted");
    if (run.outcome === "timeout") return createErrorResult(HTTP_STATUS.GATEWAY_TIMEOUT, "UC speech socket did not open in time");
    if (run.outcome === "handshake") {
      const status = run.handshakeStatus;
      if (status === 401 || status === 403) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "UC refused the speech socket token", undefined, undefined, null, secrets);
      if (status === 429) return rateLimited("UC rate limited the speech socket", run.retryAfter, secrets);
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `UC speech socket was refused with ${status}`);
    }
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "UC speech socket could not connect");
  }
  switch (run.outcome) {
    case "aborted": return after(CLIENT_CLOSED, "UC speech request aborted after it was sent");
    case "timeout": return after(HTTP_STATUS.GATEWAY_TIMEOUT, "UC speech timed out; whether it was counted is unknown");
    case "idle": return after(HTTP_STATUS.GATEWAY_TIMEOUT, "UC speech stalled; whether it was counted is unknown");
    case "malformed": return after(HTTP_STATUS.BAD_GATEWAY, "UC speech returned an undecodable audio chunk");
    case "too-large": return after(HTTP_STATUS.BAD_GATEWAY, "UC speech audio exceeded the size limit");
    case "abnormal-close": return after(HTTP_STATUS.BAD_GATEWAY, "UC speech socket closed before the audio was complete");
    case "empty":
      if (isNumber(run.usagePercent) && run.usagePercent >= 100) {
        return after(429, "UC speech quota is exhausted on this account", { quotaExhausted: true });
      }
      return after(HTTP_STATUS.BAD_GATEWAY, "UC speech produced no audio");
    default: return after(HTTP_STATUS.BAD_GATEWAY, "UC speech socket failed after the request was sent");
  }
}

/**
 * @param {object} [options] - bounds and a WebSocket constructor, for tests
 */
export function createUcTtsAdapter({ timeoutMs = UC_TTS_TOTAL_TIMEOUT_MS, mintTimeoutMs, handshakeTimeoutMs, idleTimeoutMs, maxFrameBytes, maxAudioBytes, WebSocketImpl } = {}) {
  return {
    provider: UC_PROVIDER_ID,
    models: UC_TTS_MODELS,
    responseFormats: UC_TTS_RESPONSE_FORMATS,
    /**
     * `{ base64, format: "mp3", accounting }` on success, or an error result;
     * an error after the start frame was sent carries `acceptedJob`.
     */
    async synthesize(text, model, credentials, _responseFormat, options = {}) {
      const { signal, proxyOptions } = options;
      let input;
      try {
        input = buildUcSpeechInput(model, text, options);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const credential = resolveUcCredential(credentials);
      if (!credential) {
        return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "UC credential not configured (need clientCookie, sid, uid)", undefined, undefined, null, ucSecrets(credentials));
      }
      const started = Date.now();
      const remaining = () => Math.max(1, timeoutMs - (Date.now() - started));
      const mint = await mintUcSessionToken(credential, { signal, timeoutMs: Math.min(remaining(), mintTimeoutMs ?? UC_MINT_TIMEOUT_MS) });
      if (!mint.ok) return mintFailure(mint, ucSecrets(credentials, credential));
      const secrets = ucSecrets(credentials, credential, mint.jwt);
      const url = buildUcTtsWsUrl(credential.uid, mint.jwt);
      let agent;
      try {
        agent = await proxyAgent(url, proxyOptions);
      } catch {
        return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "UC speech socket proxy is required but unavailable");
      }
      const frame = buildUcTtsStartFrame({ text: input.text, voice: input.voice, jwt: mint.jwt, model: input.model });
      const run = await runUcTtsSocket({
        url, frame, signal, agent, timeoutMs: remaining(),
        ...(handshakeTimeoutMs ? { handshakeTimeoutMs } : null),
        ...(idleTimeoutMs ? { idleTimeoutMs } : null),
        ...(maxFrameBytes ? { maxFrameBytes } : null),
        ...(maxAudioBytes ? { maxAudioBytes } : null),
        ...(WebSocketImpl ? { WebSocketImpl } : null),
      });
      if (run.outcome !== "complete") return socketFailure(run, secrets);
      if (!isMp3(run.audio)) {
        return { ...createErrorResult(HTTP_STATUS.BAD_GATEWAY, "UC speech returned audio that is not MP3"), acceptedJob: ucAcceptedJob("accepted") };
      }
      const quota = run.usagePercent !== undefined || run.thresholdCrossed !== undefined
        ? { providerQuota: { usagePercent: run.usagePercent ?? null, thresholdCrossed: run.thresholdCrossed ?? null } } : null;
      return {
        base64: Buffer.from(run.audio).toString("base64"),
        format: "mp3",
        accounting: { ...mediaAccounting(null, UC_PROVIDER_ID, MODALITY), meta: { nativeUnitsSource: "input-characters", ...quota } },
      };
    },
  };
}

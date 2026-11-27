// Gemini Live file-mode transcription adapter, staged for
// /v1/audio/transcriptions and not registered (see ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/audioTranscription.ts handleGeminiLiveTranscription
// (413 before buffering an oversized upload; `prompt` and `language` form
// fields; answer `{ text }` as JSON) and open-sse/executors/geminiLiveTranscribe.ts
// resolveLiveWsUrlAndHeaders (credentials in headers only: `x-goog-api-key`
// for an API key, else `Authorization: Bearer <accessToken>`; 401 when
// neither). Wire frames: ./request.js; socket: ./socket.js.
//
// Fork deviations: the URL is fixed (the source honored
// providerSpecificData.baseUrl and the registry base URL); egress follows the
// connection's WebSocket proxy route; the answer carries accounting with
// unknown cost; refusals never quote Gemini's text; any failure after audio
// left carries `acceptedJob` and is never retried or replayed.
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { createErrorResult, parseRateLimitEvidence } from "../../../utils/error.js";
import { resolveWebSocketProxyRoute } from "../../../utils/proxyFetch.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isFunction, isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  GEMINI_LIVE_STT_MODELS, GEMINI_LIVE_TOTAL_TIMEOUT_MS, GEMINI_LIVE_WS_URL, GEMINI_PROVIDER_ID,
} from "./config.js";
import { createGeminiLiveAudioConverter } from "./convert.js";
import { GEMINI_LIVE_RESPONSE_FORMATS, buildGeminiLiveTranscriptionRequest } from "./request.js";
import { runGeminiLiveSocket } from "./socket.js";

const MODALITY = "stt";
const CLIENT_CLOSED = 499;
const LABEL = "Gemini Live transcription";

const usable = (value) => isString(value) && value.trim() && !/[\r\n]/.test(value) ? value.trim() : null;

/** Source resolveLiveWsUrlAndHeaders, on the fixed URL: an API key wins over an access token. */
export function geminiLiveAuthHeaders(credentials) {
  const apiKey = usable(credentials?.apiKey);
  if (apiKey) return { "x-goog-api-key": apiKey };
  const accessToken = usable(credentials?.accessToken);
  if (accessToken) return { Authorization: `Bearer ${accessToken}` };
  return null;
}

const secretsOf = (credentials) => ({ apiKey: credentials?.apiKey, accessToken: credentials?.accessToken });

/** Accounting for Live work Gemini may have done (and may bill) whose outcome is not known. */
export function geminiLiveAcceptedJob(jobState = "accepted") {
  return { ...mediaAccounting(null, GEMINI_PROVIDER_ID, MODALITY), costSource: "accepted-job", meta: { jobState } };
}
const withAcceptedJob = (result, jobState) => ({ ...result, acceptedJob: geminiLiveAcceptedJob(jobState) });

async function defaultAgentFactory(proxyUrl) {
  const scheme = new URL(proxyUrl).protocol;
  if (scheme === "http:" || scheme === "https:") return new (await import("https-proxy-agent")).HttpsProxyAgent(proxyUrl);
  if (scheme === "socks:" || scheme === "socks4:" || scheme === "socks5:") {
    const { assertSocksProxyUrl } = await import("../../../utils/socksCredential.js");
    assertSocksProxyUrl(proxyUrl);
    return new (await import("socks-proxy-agent")).SocksProxyAgent(proxyUrl);
  }
  throw new Error("unsupported WebSocket proxy");
}

/** The connection's WebSocket egress agent, null for direct, or throws when a required proxy is unusable. */
async function proxyAgent(credentials, agentFactory) {
  const route = resolveWebSocketProxyRoute(GEMINI_LIVE_WS_URL, resolveCredentialProxyOptions(credentials));
  if (!route.enabled || !route.url) return null;
  const agent = await agentFactory(route.url);
  if (!agent) throw new Error("WebSocket proxy unavailable");
  return agent;
}

function rateLimited(retryAfter, secrets, message) {
  const evidence = parseRateLimitEvidence({ status: 429, headers: new Headers({ "retry-after": retryAfter ?? "" }), now: Date.now() });
  const fit = evidence?.source === "retry_after" && Number.isFinite(evidence.resetAtMs) ? evidence : null;
  return createErrorResult(429, message, fit?.resetAtMs, undefined, fit, secrets);
}

/** A refused upgrade (nothing was sent), by HTTP status. */
export function geminiLiveHandshakeRefusal(status, { secrets, retryAfter = null }) {
  if (status >= 300 && status < 400) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `${LABEL} was redirected; the redirect was not followed`);
  if (status === 401) return createErrorResult(401, `Gemini refused the credential for ${LABEL}`, undefined, undefined, null, secrets);
  if (status === 403) return createErrorResult(403, `Gemini forbade the ${LABEL} session`, undefined, undefined, null, secrets);
  if (status === 429) return { ...rateLimited(retryAfter, secrets, `Gemini rate limited ${LABEL}`), quotaExhausted: true };
  if (status === 503) return createErrorResult(503, `Gemini is unavailable for ${LABEL}`, undefined, undefined, null, secrets);
  if (status >= 400 && status < 500) return createErrorResult(status, `Gemini refused the ${LABEL} session with ${status}`, undefined, undefined, null, secrets);
  return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Gemini refused the ${LABEL} session with ${status || "an unknown status"}`, undefined, undefined, null, secrets);
}

/** A refusal before audio left: the account's or the request's fault, never billable. */
function refusedBeforeAudio(run, secrets) {
  if (run.quota) return { ...createErrorResult(429, `Gemini rate limited ${LABEL}`, undefined, undefined, null, secrets), quotaExhausted: true };
  const code = run.upstreamCode ?? run.closeCode;
  if (code === 401 || code === 4401) return createErrorResult(401, `Gemini refused the credential for ${LABEL}`, undefined, undefined, null, secrets);
  if (code === 403 || code === 4403 || code === 1008) return createErrorResult(403, `Gemini refused the ${LABEL} session`, undefined, undefined, null, secrets);
  if (code === 400 || code === 404 || code === 1007) return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Gemini rejected the ${LABEL} setup`, undefined, undefined, null, secrets);
  return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `${LABEL} session ended before audio was sent`, undefined, undefined, null, secrets);
}

function socketFailure(run, secrets) {
  if (run.outcome === "handshake") return geminiLiveHandshakeRefusal(run.handshakeStatus, { secrets, retryAfter: run.retryAfter });
  if (run.outcome === "aborted") {
    return run.sent
      ? withAcceptedJob(createErrorResult(CLIENT_CLOSED, `${LABEL} aborted after audio was sent`), "submit-unknown")
      : { ...createErrorResult(CLIENT_CLOSED, `${LABEL} aborted; no audio was sent`), local: true };
  }
  if (!run.sent) {
    if (run.outcome === "connect") return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `${LABEL} could not connect`);
    if (run.outcome === "timeout" || run.outcome === "setup-timeout") return createErrorResult(HTTP_STATUS.GATEWAY_TIMEOUT, `${LABEL} timed out before audio was sent`);
    if (run.outcome === "too-large") return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `${LABEL} sent an oversized frame before audio was sent`);
    return refusedBeforeAudio(run, secrets);
  }
  // Audio left: Gemini may have processed and billed it. Never replayed.
  if (run.quota) {
    return withAcceptedJob({ ...createErrorResult(429, `Gemini rate limited ${LABEL} mid-session; whether audio was processed is unknown`, undefined, undefined, null, secrets), quotaExhausted: true }, "submit-unknown");
  }
  const message = {
    timeout: `${LABEL} timed out; whether audio was processed is unknown`,
    "too-large": `${LABEL} answer exceeded the size limit; the result was discarded`,
    "upstream-error": `Gemini ended ${LABEL} with an error; whether audio was processed is unknown`,
  }[run.outcome] ?? `${LABEL} ended unexpectedly; whether audio was processed is unknown`;
  const status = run.outcome === "timeout" ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY;
  return withAcceptedJob(createErrorResult(status, message, undefined, undefined, null, secrets), run.audioEnded ? "accepted" : "submit-unknown");
}

/** Usage counts, kept only when numeric and non-negative. Cost is never read as USD. */
function usageMetadataOf(usage) {
  if (!isRecord(usage)) return null;
  const kept = {};
  for (const [key, value] of Object.entries(usage)) {
    if (isNumber(value) && Number.isFinite(value) && value >= 0) kept[key] = value;
    else if (Array.isArray(value)) kept[key] = value.filter((row) => isRecord(row) && isString(row.modality) && isNumber(row.tokenCount)).map((row) => ({ modality: row.modality, tokenCount: row.tokenCount }));
  }
  return Object.keys(kept).length ? kept : null;
}

/**
 * @param {object} [options]
 * @param {Function} [options.WebSocketImpl] - ws constructor; tests inject a mock
 * @param {Function} [options.agentFactory] - (proxyUrl) => agent; tests inject a mock
 * @param {number} [options.timeoutMs] - total session deadline
 * @param {object} [options.socketOptions] - extra bounds passed to runGeminiLiveSocket (tests)
 * @param {Function} [options.convertAudio] - (bytes, { signal, deadlineAt }) => { wav } | error result.
 *   Absent (the default) means only 16 kHz mono 16-bit PCM WAV is accepted. When set, conversion
 *   shares the total deadline with the session and finishes before credentials are read.
 */
export function createGeminiLiveSttAdapter({ WebSocketImpl, agentFactory = defaultAgentFactory, timeoutMs = GEMINI_LIVE_TOTAL_TIMEOUT_MS, socketOptions = {}, convertAudio = null } = {}) {
  const converting = isFunction(convertAudio);
  return {
    provider: GEMINI_PROVIDER_ID,
    models: GEMINI_LIVE_STT_MODELS,
    responseFormats: GEMINI_LIVE_RESPONSE_FORMATS,
    /**
     * STT core result contract (sttCore.js): `{ success: true, response,
     * usageValue, nativeUnits, accounting }`, or an error result; `local` marks
     * caller input errors and `acceptedJob` marks a session in which audio
     * left and whose outcome is not known.
     */
    async transcribe({ model, formData, credentials, kind, signal }) {
      if (signal?.aborted) return { ...createErrorResult(CLIENT_CLOSED, `${LABEL} aborted; no audio was sent`), local: true };
      const deadlineAt = converting ? Date.now() + timeoutMs : null;
      const built = await buildGeminiLiveTranscriptionRequest(model, formData, converting ? { kind, convertAudio, signal, deadlineAt } : { kind });
      if (!built.plan) return built;
      if (converting && signal?.aborted) return { ...createErrorResult(CLIENT_CLOSED, `${LABEL} aborted; no audio was sent`), local: true };
      const headers = geminiLiveAuthHeaders(credentials);
      if (!headers) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "No credentials for Gemini Live transcription");
      const secrets = secretsOf(credentials);
      let agent;
      try {
        agent = await proxyAgent(credentials, isFunction(agentFactory) ? agentFactory : defaultAgentFactory);
      } catch {
        return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `${LABEL} proxy is required but unavailable`);
      }
      const { plan } = built;
      const run = await runGeminiLiveSocket({
        ...socketOptions,
        url: GEMINI_LIVE_WS_URL, headers, setup: plan.setup, pcm: plan.pcm, signal, agent,
        timeoutMs: converting ? Math.max(1, deadlineAt - Date.now()) : timeoutMs,
        ...(WebSocketImpl ? { WebSocketImpl } : null),
      });
      if (run.outcome !== "complete") return socketFailure(run, secrets);
      const usageMetadata = usageMetadataOf(run.usage);
      const accounting = mediaAccounting(usageMetadata ? { usageMetadata } : null, GEMINI_PROVIDER_ID, MODALITY);
      accounting.nativeUnits = { ...accounting.nativeUnits, audioSeconds: plan.audioSeconds };
      accounting.meta = { ...accounting.meta, model: plan.model, responseFormat: "json", completion: run.completion, nativeUnitsSource: "submitted-pcm" };
      const body = JSON.stringify({ text: run.text });
      return {
        success: true,
        response: new Response(body, { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }),
        usageValue: usageMetadata ? { usage: usageMetadata } : undefined,
        nativeUnits: { audioSeconds: plan.audioSeconds },
        accounting,
      };
    },
  };
}

/**
 * The adapter registration uses: the default adapter plus the source's
 * upload conversion (./convert.js), so MP3, FLAC, Ogg, M4A, WebM, AAC and
 * non-16 kHz WAV uploads are decoded locally before any credential is read
 * or socket dialed. A normalized 16 kHz mono 16-bit PCM WAV skips ffmpeg.
 *
 * @param {object} [options] - createGeminiLiveSttAdapter options, plus
 * @param {object} [options.converterOptions] - createGeminiLiveAudioConverter options (tests inject spawn/access)
 */
export function createGeminiLiveConvertingSttAdapter({ converterOptions = {}, ...options } = {}) {
  return createGeminiLiveSttAdapter({ ...options, convertAudio: createGeminiLiveAudioConverter(converterOptions) });
}

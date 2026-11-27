// Vertex credential and endpoint resolution for the staged Gemini TTS/STT
// adapters. Reuses the local Vertex credential classifier and token minting
// (services/tokenRefresh.js) so the connection modes stay exactly those of the
// chat executor (executors/vertex.js): Service Account JSON, ADC
// `authorized_user` JSON, a pre-set access token, or an Express API key.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/executors/vertexMedia.ts, resolveVertexAuth and buildModelRequest.
// SA path: `https://{region}-aiplatform.googleapis.com/v1/projects/{project}/
// locations/{region}/publishers/google/models/{model}:{action}` with
// `Authorization: Bearer`. Express path: `https://aiplatform.googleapis.com/v1/
// publishers/google/models/{model}:{action}?key=`.
//
// Fork deviations:
// - the location is the local `providerSpecificData.location` (the chat
//   executor's field), not the source's `region`, and must be a plain Google
//   location name, so it cannot steer the host; `global` and the `us`/`eu`
//   multi-regions use the hosts the chat executor uses;
// - ADC and pre-set access tokens are accepted (local modes the source lacks),
//   with the project from `quota_project_id` or `providerSpecificData.projectId`;
// - a JSON credential that is neither SA nor ADC is refused (never sent as a key);
// - project ids must match Google's project id shape;
// - token minting is bounded by the caller's signal and a deadline.
import { classifyVertexCredential, refreshGoogleToken, refreshVertexToken, VERTEX_CREDENTIAL } from "../../tokenRefresh.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { VERTEX_AUDIO_DEFAULT_LOCATION, VERTEX_AUDIO_TOKEN_TIMEOUT_MS } from "./config.js";

export const VERTEX_GLOBAL_ORIGIN = "https://aiplatform.googleapis.com";
const PROJECT_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const REGION_RE = /^[a-z]+-[a-z]+[0-9]{1,2}$/;
const MULTI_REGIONS = new Set(["us", "eu"]);
const KEY_RE = /^[\x21-\x7e]{8,512}$/;

const refusal = (status, message) => ({ ok: false, status, message });

/** Fixed origin for a validated location, or null for anything else. */
export function vertexLocationOrigin(location) {
  if (location === "global") return VERTEX_GLOBAL_ORIGIN;
  if (MULTI_REGIONS.has(location)) return `https://aiplatform.${location}.rep.googleapis.com`;
  if (isString(location) && REGION_RE.test(location)) return `https://${location}-aiplatform.googleapis.com`;
  return null;
}

/** Race a promise with the caller's signal and a deadline; the promise itself is not cancelled. */
export function boundedWait(promise, { signal, timeoutMs, label }) {
  if (signal?.aborted) return Promise.reject(Object.assign(new Error(`${label} aborted`), { name: "AbortError" }));
  return new Promise((resolve, reject) => {
    const onAbort = () => finish(reject, Object.assign(new Error(`${label} aborted`), { name: "AbortError" }));
    const timer = setTimeout(() => finish(reject, Object.assign(new Error(`${label} timed out`), { name: "TimeoutError" })), timeoutMs);
    let done = false;
    function finish(fn, value) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      fn(value);
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then((v) => finish(resolve, v), (e) => finish(reject, e));
  });
}

const defaultMintServiceAccount = async (saJson, { log, proxyOptions }) =>
  (await refreshVertexToken(saJson, log, proxyOptions))?.accessToken ?? null;
const defaultRefreshAdc = async (adc, { log, proxyOptions }) =>
  (await refreshGoogleToken(adc.refresh_token, adc.client_id, adc.client_secret, log, proxyOptions))?.accessToken ?? null;

/**
 * Resolve how this connection authenticates and which project/location it is
 * scoped to. Nothing is sent to Vertex here; only token minting may reach
 * Google's OAuth endpoint.
 *
 * @returns {Promise<{ok: true, mode: "bearer"|"express", token: string, project: string|null, location: string|null, kind: string}
 *   | {ok: false, status: number, message: string}>}
 */
export async function resolveVertexAudioAuth(credentials, {
  signal,
  log,
  proxyOptions = null,
  mintServiceAccountToken = defaultMintServiceAccount,
  refreshAdcToken = defaultRefreshAdc,
  tokenTimeoutMs = VERTEX_AUDIO_TOKEN_TIMEOUT_MS,
} = {}) {
  const psd = isRecord(credentials?.providerSpecificData) ? credentials.providerSpecificData : {};
  const credential = classifyVertexCredential(credentials?.apiKey);
  if (credential.error) return refusal(401, credential.error);

  const storedLocation = psd.location;
  const location = storedLocation == null || storedLocation === "" ? VERTEX_AUDIO_DEFAULT_LOCATION : storedLocation;
  const presetToken = isString(credentials?.accessToken) && credentials.accessToken.trim() ? credentials.accessToken.trim() : null;
  const usesOAuth = credential.kind === VERTEX_CREDENTIAL.SERVICE_ACCOUNT || credential.kind === VERTEX_CREDENTIAL.ADC || !!presetToken;

  if (!usesOAuth) {
    if (credential.kind !== VERTEX_CREDENTIAL.API_KEY) return refusal(401, "Vertex AI credentials are required for audio");
    const key = credentials.apiKey.trim();
    if (!KEY_RE.test(key)) return refusal(401, "Vertex AI API key has an invalid shape");
    // The source's Express path is project-less and global; a stored location does not apply.
    return { ok: true, mode: "express", token: key, project: null, location: null, kind: credential.kind };
  }

  if (!vertexLocationOrigin(location)) return refusal(400, "Vertex AI location must be a Google location name such as us-central1, global, us or eu");

  let project;
  if (credential.kind === VERTEX_CREDENTIAL.SERVICE_ACCOUNT) project = credential.json.project_id;
  else if (credential.kind === VERTEX_CREDENTIAL.ADC) project = credential.json.quota_project_id || psd.projectId;
  else project = psd.projectId;
  if (!isString(project) || !PROJECT_RE.test(project)) {
    return refusal(400, "Vertex AI audio needs a valid project id (Service Account project_id, ADC quota_project_id or providerSpecificData.projectId)");
  }

  let token = presetToken;
  if (credential.kind === VERTEX_CREDENTIAL.SERVICE_ACCOUNT || credential.kind === VERTEX_CREDENTIAL.ADC) {
    const label = credential.kind === VERTEX_CREDENTIAL.SERVICE_ACCOUNT ? "Service Account token mint" : "ADC token refresh";
    const mint = credential.kind === VERTEX_CREDENTIAL.SERVICE_ACCOUNT ? mintServiceAccountToken : refreshAdcToken;
    try {
      token = await boundedWait(mint(credential.json, { log, proxyOptions }), { signal, timeoutMs: tokenTimeoutMs, label });
    } catch (error) {
      if (error?.name === "AbortError") return refusal(499, "Vertex audio request aborted");
      return refusal(401, `Vertex: ${label} ${error?.name === "TimeoutError" ? "timed out" : "failed"}`);
    }
  }
  if (!isString(token) || !token.trim() || /[\r\n]/.test(token)) return refusal(401, "Vertex: could not obtain an access token");
  return { ok: true, mode: "bearer", token: token.trim(), project, location, kind: credential.kind };
}

/**
 * The fixed generateContent endpoint for a resolved auth and an allowlisted model.
 * @returns {{url: string, origin: string, headers: Record<string, string>}}
 */
export function vertexGenerateContentRequest(auth, model) {
  const path = `publishers/google/models/${encodeURIComponent(model)}:generateContent`;
  if (auth.mode === "express") {
    return {
      url: `${VERTEX_GLOBAL_ORIGIN}/v1/${path}?key=${encodeURIComponent(auth.token)}`,
      origin: VERTEX_GLOBAL_ORIGIN,
      headers: { "Content-Type": "application/json" },
    };
  }
  const origin = vertexLocationOrigin(auth.location);
  if (!origin) throw new Error("Vertex location is not a Google location");
  return {
    url: `${origin}/v1/projects/${auth.project}/locations/${auth.location}/${path}`,
    origin,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` },
  };
}

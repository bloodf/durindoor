// Vertex Veo credential scope and endpoints for the selected connection.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/executors/vertexMedia.ts (resolveVertexAuth, buildModelRequest:
// a Service Account JSON mints a Bearer token and uses the project-scoped
// regional endpoint; an Express API key uses the project-less global
// publisher endpoint with `?key=`).
//
// Fork deviations, following this fork's chat executor (executors/vertex.js)
// so a connection has one credential scope for chat and video:
// - credentials are classified by services/tokenRefresh.js; an authorized_user
//   ADC file and a preset access token are Bearer credentials too, and a JSON
//   document of any other shape is refused (never sent as a raw key);
// - the project is the Service Account `project_id`, the ADC
//   `quota_project_id`, or `providerSpecificData.projectId`;
// - the location is `providerSpecificData.location` (the source read
//   `region`), us-central1 by default, and must be a regional location id:
//   the regional host is built from it, so anything else is refused rather
//   than rerouted;
// - token minting is bounded and abortable by the caller.
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { classifyVertexCredential, refreshGoogleToken, refreshVertexToken, VERTEX_CREDENTIAL } from "../../tokenRefresh.js";
import { isString } from "../../../../src/shared/utils/typeChecks.js";
import { VERTEX_VIDEO_DEFAULT_LOCATION } from "./config.js";

/** The Express-mode origin (project-less publisher endpoint). */
export const VERTEX_EXPRESS_ORIGIN = "https://aiplatform.googleapis.com";
// Regional ids such as us-central1, europe-west4, northamerica-northeast1.
const LOCATION_RE = /^[a-z]{2,15}-[a-z]{2,15}[1-9][0-9]?$/;
// Google Cloud project ids.
const PROJECT_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const TOKEN_RE = /^[\x21-\x7e]{1,4096}$/;

const authError = (message, status = 401) => Object.assign(new Error(message), { status });

/** The regional Vertex origin for a validated location. */
export const vertexRegionalOrigin = (location) => `https://${location}-aiplatform.googleapis.com`;

/**
 * Where a Vertex publisher-model action is sent for this connection, without
 * any network call. `token` is filled in by resolveVertexVideoAuth.
 *
 * @returns {{ mode: "bearer"|"express", project?: string, location?: string, origin: string, credential: object }}
 */
export function vertexVideoScope(credentials) {
  const classified = classifyVertexCredential(credentials?.apiKey);
  if (classified.error) throw authError(classified.error);
  const psd = credentials?.providerSpecificData ?? {};
  const presetToken = isString(credentials?.accessToken) && credentials.accessToken.trim() ? credentials.accessToken.trim() : null;
  const sa = classified.kind === VERTEX_CREDENTIAL.SERVICE_ACCOUNT ? classified.json : null;
  const adc = classified.kind === VERTEX_CREDENTIAL.ADC ? classified.json : null;

  if (sa || adc || presetToken) {
    const project = sa?.project_id || adc?.quota_project_id || psd.projectId;
    if (!isString(project) || !PROJECT_RE.test(project)) {
      throw authError("Vertex video needs a Google Cloud project id: use a Service Account JSON or set the connection's project id", HTTP_STATUS.BAD_REQUEST);
    }
    const location = psd.location === undefined || psd.location === null || psd.location === "" ? VERTEX_VIDEO_DEFAULT_LOCATION : psd.location;
    if (!isString(location) || !LOCATION_RE.test(location)) {
      throw authError("Vertex Veo needs a regional location (for example us-central1); this connection's location is not one", HTTP_STATUS.BAD_REQUEST);
    }
    return { mode: "bearer", project, location, origin: vertexRegionalOrigin(location), credential: { sa, adc, presetToken } };
  }
  if (classified.kind === VERTEX_CREDENTIAL.API_KEY) {
    const key = credentials.apiKey.trim();
    if (!TOKEN_RE.test(key)) throw authError("Vertex API key is malformed");
    return { mode: "express", origin: VERTEX_EXPRESS_ORIGIN, credential: { key } };
  }
  throw authError("Vertex video requires a Service Account JSON, an authorized_user ADC file, an access token with a project id, or a Vertex AI Express API key");
}

/** The default token minter: the chat executor's Service Account and ADC refreshers. */
export async function defaultVertexTokenMinter({ sa, adc }, { log, proxyOptions }) {
  if (sa) return (await refreshVertexToken(sa, log, proxyOptions))?.accessToken ?? null;
  if (adc) return (await refreshGoogleToken(adc.refresh_token, adc.client_id, adc.client_secret, log, proxyOptions))?.accessToken ?? null;
  return null;
}

/**
 * Resolve the scope and, for Bearer credentials, the access token. Minting is
 * bounded by `timeoutMs` and the caller's signal; nothing billable is sent.
 */
export async function resolveVertexVideoAuth(credentials, { mintToken = defaultVertexTokenMinter, log, proxyOptions, signal, timeoutMs }) {
  const scope = vertexVideoScope(credentials);
  if (scope.mode === "express") return { ...scope, token: null };
  const { presetToken } = scope.credential;
  let token = presetToken;
  if (!token) {
    let timer;
    let onAbort;
    const bound = new Promise((_, reject) => {
      timer = setTimeout(() => reject(authError("Vertex access token request timed out", HTTP_STATUS.GATEWAY_TIMEOUT)), timeoutMs);
      onAbort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    const minted = Promise.resolve().then(() => mintToken(scope.credential, { log, proxyOptions, signal }));
    try {
      token = await Promise.race([minted, bound]);
    } catch (error) {
      if (error?.name === "AbortError" || error?.status) throw error;
      throw authError("Vertex access token could not be obtained");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      minted.catch(() => {});
      bound.catch(() => {});
    }
  }
  if (!isString(token) || !TOKEN_RE.test(token)) throw authError("Vertex access token could not be obtained");
  return { ...scope, token };
}

/** The URL and headers of one publisher-model action for a resolved scope. */
export function vertexVideoAction(auth, model, action) {
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  const path = `publishers/google/models/${encodeURIComponent(model)}:${action}`;
  if (auth.mode === "bearer") {
    headers.Authorization = `Bearer ${auth.token}`;
    return { url: `${auth.origin}/v1/projects/${auth.project}/locations/${auth.location}/${path}`, headers };
  }
  return { url: `${auth.origin}/v1/${path}?key=${encodeURIComponent(auth.credential.key)}`, headers };
}

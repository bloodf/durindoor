// Credential scope for vertex-deepseek-ocr: the project, region and Bearer
// token of the selected connection. Source: OmniRoute c71f0065
// open-sse/handlers/ocr.ts (resolveVertexOcrBaseUrl, resolveVertexOcrAccessToken).
//
// Fork rules on top of the source:
// - credentials are classified by services/tokenRefresh.js, as this fork's
//   Vertex chat and video paths do; an authorized_user ADC file is a Bearer
//   credential too, and a JSON document of any other shape is refused (never
//   sent as a raw token);
// - the project is providerSpecificData.project (the source field) or
//   .projectId (this fork's Vertex field), else the Service Account
//   project_id or the ADC quota_project_id; the region is
//   providerSpecificData.region (source) or .location (fork), us-central1 by
//   default. Both must be plain Google Cloud ids because they are built into
//   the URL path; conflicting spellings are refused;
// - a configured base URL (a dedicated endpoint) is refused, not followed:
//   only the project/region endpoint on the Vertex origin is supported;
// - token minting is bounded and abortable, and happens only after the
//   request was validated.
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { classifyVertexCredential, refreshGoogleToken, refreshVertexToken, VERTEX_CREDENTIAL } from "../../tokenRefresh.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { VERTEX_DEEPSEEK_OCR_DEFAULT_REGION } from "./config.js";

// Regional ids such as us-central1, europe-west4, northamerica-northeast1.
const REGION_RE = /^[a-z]{2,15}-[a-z]{2,15}[1-9][0-9]?$/;
// Google Cloud project ids.
const PROJECT_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
// A Bearer token: printable ASCII, no spaces, bounded.
const TOKEN_RE = /^[\x21-\x7e]{1,4096}$/;

const authError = (message, status = 401) => Object.assign(new Error(message), { status, vertexOcrAuth: true });
const filled = (value) => value !== undefined && value !== null && value !== "";

/** One value from two spellings of the same setting; differing values are refused. */
function either(psd, sourceName, forkName, what) {
  const a = psd[sourceName];
  const b = psd[forkName];
  if (filled(a) && filled(b) && a !== b) {
    throw authError(`Vertex DeepSeek-OCR connection sets ${sourceName} and ${forkName} to different ${what}s`, HTTP_STATUS.BAD_REQUEST);
  }
  return filled(a) ? a : filled(b) ? b : undefined;
}

/**
 * Where the OCR request goes for this connection and how it authenticates,
 * without any network call.
 *
 * @returns {{ project: string, region: string, credential: { presetToken: string|null, sa: object|null, adc: object|null, rawToken: string|null } }}
 * @throws an error with `status` (400 for configuration, 401 for credentials)
 */
export function vertexDeepseekOcrScope(credentials) {
  const psd = isRecord(credentials?.providerSpecificData) ? credentials.providerSpecificData : {};
  const configuredBase = [credentials?.baseUrl, psd.baseUrl].find((value) => isString(value) && value.trim());
  if (configuredBase) {
    throw authError("Vertex DeepSeek-OCR dedicated endpoint URLs are not supported; set the connection's project and region instead", HTTP_STATUS.BAD_REQUEST);
  }

  const classified = classifyVertexCredential(credentials?.apiKey);
  if (classified.error) throw authError(classified.error);
  const presetToken = isString(credentials?.accessToken) && credentials.accessToken.trim() ? credentials.accessToken.trim() : null;
  const sa = classified.kind === VERTEX_CREDENTIAL.SERVICE_ACCOUNT ? classified.json : null;
  const adc = classified.kind === VERTEX_CREDENTIAL.ADC ? classified.json : null;
  const rawToken = classified.kind === VERTEX_CREDENTIAL.API_KEY ? credentials.apiKey.trim() : null;
  if (!presetToken && !sa && !adc && !rawToken) {
    throw authError("Vertex DeepSeek-OCR needs an access token, a Service Account JSON or an authorized_user ADC file");
  }
  if (presetToken && !TOKEN_RE.test(presetToken)) throw authError("Vertex access token is malformed");
  if (!presetToken && rawToken && !TOKEN_RE.test(rawToken)) throw authError("Vertex access token is malformed");

  const project = either(psd, "project", "projectId", "project") ?? sa?.project_id ?? adc?.quota_project_id;
  if (!isString(project) || !PROJECT_RE.test(project)) {
    throw authError("Vertex DeepSeek-OCR needs a Google Cloud project id: set the connection's project or use a Service Account JSON", HTTP_STATUS.BAD_REQUEST);
  }
  const region = either(psd, "region", "location", "region") ?? VERTEX_DEEPSEEK_OCR_DEFAULT_REGION;
  if (!isString(region) || !REGION_RE.test(region)) {
    throw authError("Vertex DeepSeek-OCR needs a regional location such as us-central1", HTTP_STATUS.BAD_REQUEST);
  }
  return { project, region, credential: { presetToken, sa, adc, rawToken } };
}

/** The default minter: this fork's Service Account and ADC token refreshers. */
export async function defaultVertexOcrTokenMinter({ sa, adc }, { log, proxyOptions }) {
  if (sa) return (await refreshVertexToken(sa, log, proxyOptions))?.accessToken ?? null;
  if (adc) return (await refreshGoogleToken(adc.refresh_token, adc.client_id, adc.client_secret, log, proxyOptions))?.accessToken ?? null;
  return null;
}

/**
 * The Bearer token for a resolved scope. Precedence follows the source: an
 * existing access token, then a minted one, then a raw key used as a token.
 * Minting is bounded by `timeoutMs` and the caller's signal.
 */
export async function resolveVertexOcrToken(scope, { mintToken = defaultVertexOcrTokenMinter, log, proxyOptions, signal, timeoutMs }) {
  const { presetToken, sa, adc, rawToken } = scope.credential;
  if (presetToken) return presetToken;
  if (!sa && !adc) return rawToken;
  if (signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
  let timer;
  let onAbort;
  const bound = new Promise((_, reject) => {
    timer = setTimeout(() => reject(authError("Vertex access token request timed out", HTTP_STATUS.GATEWAY_TIMEOUT)), Math.max(1, timeoutMs));
    onAbort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  const minted = Promise.resolve().then(() => mintToken({ sa, adc }, { log, proxyOptions, signal }));
  let token;
  try {
    token = await Promise.race([minted, bound]);
  } catch (error) {
    if (error?.name === "AbortError" || error?.vertexOcrAuth) throw error;
    throw authError("Vertex access token could not be obtained");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    minted.catch(() => {});
    bound.catch(() => {});
  }
  if (!isString(token) || !TOKEN_RE.test(token)) throw authError("Vertex access token could not be obtained");
  return token;
}

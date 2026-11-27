/**
 * Dynamic Lyria model discovery for a Gemini API connection.
 *
 * Source: OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad
 * src/lib/providerModels/geminiModelsParser.ts: a `models.list` entry whose id
 * starts with `lyria-` and whose supportedGenerationMethods include
 * `generateContent` is a music model (its chat endpoint is removed).
 *
 * Local deviations: the key is sent in `x-goog-api-key` (not `?key=`) so it never
 * appears in a URL; OAuth connections send `Authorization: Bearer`. Pages are
 * bounded in count and size, redirects are refused, and errors carry only the
 * HTTP status plus the Google status enum.
 */
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { proxyAwareFetch } from "../../../utils/proxyFetch.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { GEMINI_MUSIC_BASE_URL, GEMINI_MUSIC_CONFIG, GEMINI_MUSIC_MODEL_ID, GEMINI_MUSIC_ORIGIN, GEMINI_MUSIC_PROVIDER_ID } from "./config.js";
import { buildGeminiMusicAuth, clampMs, discardBody, googleStatusLabel, raceStop, readBounded } from "./transport.js";

const PAGE_SIZE = 1000;
const MAX_PAGES = 10;
const MAX_PAGE_BYTES = 4 * 1024 * 1024;
const MAX_NAME_LENGTH = 120;
const PAGE_TOKEN = /^[A-Za-z0-9_\-=.+/]{1,512}$/;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

const discoveryError = (status, message) => Object.assign(new Error(message), { status });

/** Static catalog from the pinned registry entry. */
export function listGeminiMusicModels() {
  return GEMINI_MUSIC_CONFIG.models.map((m) => ({ ...m, provider: GEMINI_MUSIC_PROVIDER_ID, serviceKinds: ["music"] }));
}

/** The models.list page URL. Only the fixed Gemini API origin is ever produced. */
export function geminiMusicDiscoveryUrl(pageToken = null) {
  const url = new URL(GEMINI_MUSIC_BASE_URL);
  url.searchParams.set("pageSize", String(PAGE_SIZE));
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  return url.toString();
}

/** Pure parser for one models.list payload (source geminiModelsParser Lyria rule). */
export function parseGeminiMusicModels(payload) {
  const models = Array.isArray(payload?.models) ? payload.models : [];
  const out = [];
  for (const entry of models) {
    if (!isRecord(entry)) continue;
    const rawId = isString(entry.name) ? entry.name : isString(entry.id) ? entry.id : "";
    const id = rawId.replace(/^models\//, "");
    const methods = Array.isArray(entry.supportedGenerationMethods) ? entry.supportedGenerationMethods : [];
    // Source rule matches case-insensitively; only an exact lowercase id is safe to route.
    if (!id.toLowerCase().startsWith("lyria-") || !methods.includes("generateContent")) continue;
    if (!GEMINI_MUSIC_MODEL_ID.test(id)) continue;
    const displayName = isString(entry.displayName) && entry.displayName.trim() ? entry.displayName.trim().slice(0, MAX_NAME_LENGTH) : id;
    if (out.some((m) => m.id === id)) continue;
    out.push({ id, name: displayName, provider: GEMINI_MUSIC_PROVIDER_ID, serviceKinds: ["music"], endpoints: ["music"] });
  }
  return out;
}

/**
 * List the Lyria models visible to the selected connection.
 * Resolves `[{ id, name, provider: "gemini", serviceKinds: ["music"], endpoints }]`;
 * throws `{ status, message }` without any upstream body.
 */
export async function discoverGeminiMusicModels({ credentials, signal = null, fetchImpl = proxyAwareFetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const auth = buildGeminiMusicAuth(credentials);
  if (!auth) throw discoveryError(401, "Gemini API key or OAuth access token is required");
  const deadline = AbortSignal.timeout(clampMs(timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS));
  const overall = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const proxyOptions = resolveCredentialProxyOptions(credentials);
  const headers = { ...auth.headers, Accept: "application/json" };
  delete headers["Content-Type"];

  const found = [];
  let pageToken = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = geminiMusicDiscoveryUrl(pageToken);
    if (new URL(url).origin !== GEMINI_MUSIC_ORIGIN) throw discoveryError(500, "Gemini discovery origin rejected");
    let response;
    try {
      response = await raceStop(fetchImpl(url, { method: "GET", headers, signal: overall, redirect: "manual" }, proxyOptions), overall, signal);
    } catch (error) {
      if (error?.kind) throw discoveryError(error.kind === "abort" ? 499 : 504, `Gemini model discovery ${error.kind === "abort" ? "aborted" : "timed out"}`);
      throw discoveryError(502, "Gemini model discovery network failure");
    }
    if (response.status >= 300 && response.status < 400) {
      discardBody(response);
      throw discoveryError(502, `Gemini model discovery was redirected (HTTP ${response.status}); the redirect was not followed`);
    }
    if (!response.ok) {
      let label = "";
      try {
        const read = await readBounded(response, 16 * 1024, overall, signal);
        label = read.text ? googleStatusLabel(read.text) : "";
      } catch { /* never surfaced */ }
      throw discoveryError(response.status, `Gemini model discovery failed (HTTP ${response.status}${label})`);
    }
    let payload;
    try {
      const read = await readBounded(response, MAX_PAGE_BYTES, overall, signal);
      if (read.tooLarge) throw new Error("too large");
      payload = JSON.parse(read.text);
    } catch (error) {
      if (error?.kind) throw discoveryError(error.kind === "abort" ? 499 : 504, `Gemini model discovery ${error.kind === "abort" ? "aborted" : "timed out"}`);
      throw discoveryError(502, "Gemini model discovery returned an unreadable page");
    }
    if (!isRecord(payload) || (payload.models !== undefined && !Array.isArray(payload.models))) {
      throw discoveryError(502, "Gemini model discovery returned a malformed page");
    }
    for (const model of parseGeminiMusicModels(payload)) {
      if (!found.some((m) => m.id === model.id)) found.push(model);
    }
    const next = payload.nextPageToken;
    if (!isString(next) || !next) return found;
    if (!PAGE_TOKEN.test(next) || next === pageToken) throw discoveryError(502, "Gemini model discovery returned an invalid page token");
    pageToken = next;
  }
  throw discoveryError(502, `Gemini model discovery exceeded ${MAX_PAGES} pages`);
}

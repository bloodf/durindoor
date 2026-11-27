// Arena (lmarena) image: DORMANT reference code. The adapter never calls these
// functions and nothing here touches the network. They pin two things a later
// change must start from instead of guessing:
//
// 1. buildLmarenaSourceImageWire: the exact request the pinned source would
//    send for an lmarena image model. The source image entry has format
//    "openai", so handlers/imageGeneration.ts hands it to
//    handleOpenAIImageGeneration, which builds an OpenAI images body, sets
//    Authorization only for authHeader "bearer" and x-api-key only for
//    "x-api-key" (never a Cookie), and POSTs with plain fetch to baseUrl
//    (openAiImageFetch.ts fetchImageEndpoint), then expects an OpenAI
//    `{ data: [...] }` JSON answer. create-evaluation is the Arena chat SSE
//    endpoint (executors/lmarena.ts sends `{ id, mode: "direct-battle",
//    modelAId, userMessage, modality: "chat", ... }` there with the session
//    cookie through the Chrome-TLS client). The source image wire is therefore
//    not an Arena contract, and this fork does not replay it.
// 2. resolveLmarenaImageCookie: the source session-cookie reader
//    (executors/lmarena/cookie.ts readLMArenaCookie + reconstructLMArenaCookie),
//    so a future native transport reuses the existing lmarena cookie
//    connection unchanged.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT).
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { LMARENA_AUTH_COOKIE, LMARENA_IMAGE_BASE_URL } from "./config.js";

/** Why the source wire is not a native Arena image contract (evidence, source line by line). */
export const LMARENA_SOURCE_WIRE_DEFECTS = Object.freeze([
  "imageRegistryData.ts lmarena: format \"openai\" -> handleOpenAIImageGeneration (no lmarena branch in handleImageGeneration)",
  "handleOpenAIImageGeneration sets Authorization for authHeader \"bearer\" and x-api-key for \"x-api-key\" only; authHeader \"cookie\" sends no credential",
  "the body is an OpenAI images body { model, prompt, n, size, quality, response_format, style }, not the Arena create-evaluation envelope",
  "fetchImageEndpoint uses plain fetch, not the Chrome-TLS client the Arena chat executor needs behind Cloudflare",
  "the answer is parsed as OpenAI image JSON; create-evaluation answers an AI-SDK SSE stream whose parser (executors/lmarena/stream.ts) has no image event",
  "LMARENA_DIRECT_IMAGE_MODELS ids are catalog names, not the arenaId UUIDs the executor resolves for modelAId",
]);

/**
 * The request the pinned source builds for an lmarena image call (evidence
 * only; never sent). Output-format options (prepareImageOutputOptions) are not
 * modelled: they only apply when output_format is requested.
 */
export function buildLmarenaSourceImageWire(model, body = {}) {
  const upstream = { model, prompt: body.prompt };
  for (const key of ["n", "size", "quality", "response_format", "style"]) {
    if (body[key] !== undefined) upstream[key] = body[key];
  }
  return {
    method: "POST",
    url: LMARENA_IMAGE_BASE_URL,
    headers: { "Content-Type": "application/json" },
    body: upstream,
  };
}

function parseCookieBlob(blob) {
  const pairs = [];
  for (const part of blob.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    pairs.push({ name, value: part.slice(eq + 1).trim() });
  }
  return pairs;
}

/** Source reconstructLMArenaCookie: join ascending `arena-auth-prod-v1.N` chunks into one cookie. */
export function reconstructLmarenaImageCookie(rawCookie) {
  if (!isString(rawCookie) || !rawCookie.trim()) return rawCookie;
  const pairs = parseCookieBlob(rawCookie);
  const existing = pairs.find((pair) => pair.name === LMARENA_AUTH_COOKIE);
  if (existing && existing.value) return rawCookie;
  const chunkPrefix = `${LMARENA_AUTH_COOKIE}.`;
  const chunks = new Map();
  for (const { name, value } of pairs) {
    if (!name.startsWith(chunkPrefix)) continue;
    const index = name.slice(chunkPrefix.length);
    if (/^\d+$/.test(index)) chunks.set(Number(index), value);
  }
  const parts = [];
  for (let i = 0; chunks.has(i); i++) parts.push(chunks.get(i) ?? "");
  const joined = parts.join("");
  if (!joined) return rawCookie;
  const preserved = pairs.filter((pair) => pair.name !== LMARENA_AUTH_COOKIE && !pair.name.startsWith(chunkPrefix));
  return [`${LMARENA_AUTH_COOKIE}=${joined}`, ...preserved.map((pair) => `${pair.name}=${pair.value}`)].join("; ");
}

function cookieFromStoredFields(data) {
  const pairs = [];
  for (const [name, value] of Object.entries(data)) {
    if (name !== LMARENA_AUTH_COOKIE && !name.startsWith(`${LMARENA_AUTH_COOKIE}.`)) continue;
    if (!isString(value) || !value.trim()) continue;
    pairs.push(`${name}=${value.trim()}`);
  }
  return pairs.length ? reconstructLmarenaImageCookie(pairs.join("; ")) : "";
}

/**
 * Source readLMArenaCookie precedence: cookie, apiKey, top-level chunk fields,
 * providerSpecificData.cookie, providerSpecificData chunk fields. The first
 * three keys match the local chat executor (cookie || apiKey ||
 * providerSpecificData.cookie); chunk fields are the source addition.
 */
export function resolveLmarenaImageCookie(credentials) {
  if (!isRecord(credentials)) return "";
  if (isString(credentials.cookie) && credentials.cookie.trim()) return reconstructLmarenaImageCookie(credentials.cookie);
  if (isString(credentials.apiKey) && credentials.apiKey.trim()) return reconstructLmarenaImageCookie(credentials.apiKey);
  const topLevel = cookieFromStoredFields(credentials);
  if (topLevel) return topLevel;
  const psd = credentials.providerSpecificData;
  if (isRecord(psd)) {
    if (isString(psd.cookie) && psd.cookie.trim()) return reconstructLmarenaImageCookie(psd.cookie);
    const nested = cookieFromStoredFields(psd);
    if (nested) return nested;
  }
  return "";
}

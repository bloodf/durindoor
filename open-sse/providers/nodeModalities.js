// Media input a user-defined compatible node reports for its own models
// (port of upstream decolua/9router#5818, hardened for DurinDoor).
//
// A node (openai-compatible-* or anthropic-compatible-*) usually serves models
// no capability table knows, so getCapabilitiesForModel falls to
// DEFAULT_CAPABILITIES (vision:false) and stripUnsupportedModalities replaces
// every image with a placeholder before the request leaves the router, even
// when the server says the model reads images. This asks the node what it
// serves and only ever turns a capability ON.
//
// Security and isolation invariants:
//   - Every probe goes through guardedProbeFetch (SSRF/metadata validation,
//     pinned DNS dispatcher, redirect: "manual").
//   - Active proxyOptions route through proxyAwareFetch.
//   - Cache keys hash provider, baseUrl, connection/token identity, proxy
//     contract, and guard mode so sibling connections never share probe state.
//   - Derived /api/v0/models and /api/show URLs are validated to keep the
//     exact origin of baseUrl before sending credentials.
//   - Sources, first that answers wins (all cached with bounded size + TTL):
//       1. GET {baseUrl}/models — input_modalities, architecture.input_modalities,
//          modalities.input, capabilities: ["vision", ...]
//       2. GET {origin}/api/v0/models — LM Studio native list (type "vlm")
//       3. POST {origin}/api/show {model} — Ollama per-model capabilities

import { createHash } from "node:crypto";
import { getProviderValidationGuard, guardedProbeFetch } from "../utils/outboundUrlGuard.js";
import { hasMediaBlocks } from "../translator/concerns/modality.js";
import { isFunction, isObject, isString } from "../../src/shared/utils/typeChecks.js";

const TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 3000;
const MAX_NODE_CACHE_ENTRIES = 256;
const MAX_SHOWN_CACHE_ENTRIES = 1024;
const NODE_PREFIXES = ["openai-compatible-", "anthropic-compatible-"];
const LEGACY_MEDIA_RE = /"(?:images|experimental_attachments|attachments)"\s*:|data:(?:image|audio)\/|data:application\/pdf/i;

const cache = new Map(); // scopeKey -> { at, models: Map<modelId, caps> }
const shown = new Map(); // `${scopeKey}\0${model}` -> { at, caps|null }
const inflight = new Map();

const lower = (v) => (Array.isArray(v) ? v.filter((x) => isString(x)).map((x) => x.toLowerCase()) : []);
const isCompatibleNode = (provider) => isString(provider) && NODE_PREFIXES.some((prefix) => provider.startsWith(prefix));

function setBounded(map, key, value, maxSize) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > maxSize) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

/**
 * True when the request body contains any media block or legacy media field
 * that stripUnsupportedModalities could strip. Avoids probing on text-only turns.
 *
 * @param {unknown} body Request body in any source format.
 * @returns {boolean}
 */
export function hasStripEligibleMedia(body) {
  if (!body || !isObject(body)) return false;
  if (hasMediaBlocks(body)) return true;
  try {
    return LEGACY_MEDIA_RE.test(JSON.stringify(body));
  } catch {
    return false;
  }
}

/**
 * Extract supported media input capabilities from a model catalog row.
 * Returns `{ vision?, audioInput?, pdf? }` (true-only) or `null` when nothing
 * about input modalities is declared.
 *
 * @param {unknown} entry Raw model entry from /models, /api/v0/models, or /api/show.
 * @returns {{ vision?: true, audioInput?: true, pdf?: true } | null}
 */
export function modalitiesFromModelEntry(entry) {
  if (!entry || !isObject(entry)) return null;
  const input = [
    ...lower(entry.input_modalities),
    ...lower(entry.architecture?.input_modalities),
    ...lower(entry.modalities?.input),
  ];
  const capsList = lower(entry.capabilities);
  const type = isString(entry.type) ? entry.type.toLowerCase() : "";
  if (type === "vlm") capsList.push("vision"); // LM Studio
  if (!input.length && !capsList.length) return null;
  const out = {};
  if (input.includes("image") || capsList.includes("vision")) out.vision = true;
  if (input.includes("audio") || capsList.includes("audio")) out.audioInput = true;
  if (input.includes("pdf") || input.includes("file")) out.pdf = true;
  return out;
}

function headersFor(provider, token) {
  const headers = { accept: "application/json" };
  if (provider.startsWith("anthropic-compatible-")) {
    headers["anthropic-version"] = "2023-06-01";
    if (token) headers["x-api-key"] = token;
  } else if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}

function resolveNodeEndpoints(provider, rawBaseUrl) {
  const trimmed = String(rawBaseUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  const isAnthropic = provider.startsWith("anthropic-compatible-");
  const normalizedBase = isAnthropic && /\/messages(?:\/models)?$/i.test(trimmed)
    ? trimmed.replace(/\/messages(?:\/models)?$/i, "")
    : trimmed;
  const modelsUrl = `${normalizedBase}/models`;

  const originPath = parsed.pathname
    .replace(/\/+$/, "")
    .replace(/\/messages(?:\/models)?$/i, "")
    .replace(/\/v\d+$/i, "");
  const sameOriginUrl = (suffix) => {
    const candidate = new URL(`${parsed.origin}${originPath}${suffix}`);
    return candidate.origin === parsed.origin ? candidate.toString() : null;
  };
  return {
    normalizedBase,
    modelsUrl,
    lmStudioUrl: sameOriginUrl("/api/v0/models"),
    ollamaShowUrl: sameOriginUrl("/api/show"),
  };
}

function proxySignature(proxyOptions) {
  if (!proxyOptions || !isObject(proxyOptions)) return "";
  return JSON.stringify([
    proxyOptions.proxyMode || "",
    proxyOptions.connectionProxyEnabled === true,
    proxyOptions.connectionProxyUrl || "",
    proxyOptions.connectionNoProxy || "",
    proxyOptions.vercelRelayUrl || "",
    proxyOptions.strictProxy === true,
    proxyOptions.disableEnvProxy === true,
  ]);
}

function needsProxyTransport(proxyOptions) {
  if (!proxyOptions || !isObject(proxyOptions)) return false;
  return proxyOptions.connectionProxyEnabled === true ||
    Boolean(proxyOptions.vercelRelayUrl) ||
    proxyOptions.strictProxy === true ||
    proxyOptions.proxyMode === "strict-pool" ||
    proxyOptions.disableEnvProxy === true;
}

async function resolveTransport(fetchImpl, proxyOptions) {
  if (isFunction(fetchImpl)) return fetchImpl;
  if (needsProxyTransport(proxyOptions)) {
    const { proxyAwareFetch } = await import("../utils/proxyFetch.js");
    return (url, init) => {
      const options = proxyOptions.vercelRelayUrl ? { ...init } : init;
      if (proxyOptions.vercelRelayUrl) delete options.dispatcher;
      return proxyAwareFetch(url, options, proxyOptions);
    };
  }
  return isFunction(globalThis.fetch) ? (url, init) => globalThis.fetch(url, init) : null;
}

function scopeKeyFor(provider, normalizedBase, credentials, proxyOptions, guard) {
  const token = credentials?.apiKey || credentials?.accessToken || "";
  const connectionId = credentials?.connectionId || credentials?.id || "";
  return createHash("sha256")
    .update(JSON.stringify([provider, normalizedBase, String(connectionId), String(token), proxySignature(proxyOptions), guard]))
    .digest("hex");
}

function buildProbeSignal(callerSignal) {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  if (!callerSignal) return timeout;
  return AbortSignal.any([callerSignal, timeout]);
}

async function fetchJson(transport, url, init, guard, callerSignal) {
  if (!url || callerSignal?.aborted) return { ok: false, aborted: Boolean(callerSignal?.aborted), data: null };
  try {
    const response = await guardedProbeFetch(
      url,
      { ...init, cache: "no-store", signal: buildProbeSignal(callerSignal) },
      guard,
      transport
    );
    if (!response?.ok) return { ok: false, aborted: false, data: null };
    return { ok: true, aborted: false, data: await response.json() };
  } catch {
    return { ok: false, aborted: Boolean(callerSignal?.aborted), data: null };
  }
}

function collect(list, into) {
  for (const entry of Array.isArray(list) ? list : []) {
    const id = entry?.id || entry?.name || entry?.model;
    const caps = modalitiesFromModelEntry(entry);
    if (id && caps) into.set(String(id), caps);
  }
}

async function loadLists(scopeKey, provider, endpoints, token, transport, guard, signal) {
  const headers = headersFor(provider, token);
  const models = new Map();
  const std = await fetchJson(transport, endpoints.modelsUrl, { method: "GET", headers }, guard, signal);
  if (std.aborted) return;
  collect(std.data?.data || std.data?.models, models);
  if (!models.size && endpoints.lmStudioUrl) {
    const lms = await fetchJson(transport, endpoints.lmStudioUrl, { method: "GET", headers }, guard, signal);
    if (lms.aborted) return;
    collect(lms.data?.data || lms.data?.models, models);
  }
  setBounded(cache, scopeKey, { at: Date.now(), models }, MAX_NODE_CACHE_ENTRIES);
}

async function loadShow(showKey, provider, endpoints, token, model, transport, guard, signal) {
  if (!endpoints.ollamaShowUrl) {
    setBounded(shown, showKey, { at: Date.now(), caps: null }, MAX_SHOWN_CACHE_ENTRIES);
    return;
  }
  const headers = { ...headersFor(provider, token), "content-type": "application/json" };
  const res = await fetchJson(
    transport,
    endpoints.ollamaShowUrl,
    { method: "POST", headers, body: JSON.stringify({ model }) },
    guard,
    signal
  );
  if (res.aborted) return;
  setBounded(shown, showKey, { at: Date.now(), caps: modalitiesFromModelEntry(res.data) }, MAX_SHOWN_CACHE_ENTRIES);
}

function once(key, start) {
  if (!inflight.has(key)) inflight.set(key, start().finally(() => inflight.delete(key)));
  return inflight.get(key);
}

const fresh = (entry) => Boolean(entry) && Date.now() - entry.at <= TTL_MS;

/**
 * Capabilities a compatible node reports for `model`, or `null`.
 * Accepts either a custom `fetchImpl` function or `{ fetchImpl, proxyOptions, guard, signal }`.
 *
 * @param {string} provider Compatible provider id (`openai-compatible-*` / `anthropic-compatible-*`).
 * @param {string} model Model id as the node serves it.
 * @param {object} credentials Connection credentials (`providerSpecificData.baseUrl`, `apiKey` / `accessToken`).
 * @param {Function | { fetchImpl?: Function, proxyOptions?: object, guard?: string, signal?: AbortSignal }} [optionsOrFetch]
 * @returns {Promise<{ vision?: true, audioInput?: true, pdf?: true } | null>}
 */
export async function getNodeReportedModalities(provider, model, credentials, optionsOrFetch = undefined) {
  if (!isCompatibleNode(provider) || !model) return null;
  const opts = isFunction(optionsOrFetch) ? { fetchImpl: optionsOrFetch } : (optionsOrFetch || {});
  const endpoints = resolveNodeEndpoints(provider, credentials?.providerSpecificData?.baseUrl);
  if (!endpoints) return null;
  const transport = await resolveTransport(opts.fetchImpl, opts.proxyOptions);
  if (!transport) return null;

  const guard = opts.guard ?? getProviderValidationGuard();
  const token = credentials?.apiKey || credentials?.accessToken || "";
  const id = String(model);
  const scopeKey = scopeKeyFor(provider, endpoints.normalizedBase, credentials, opts.proxyOptions, guard);

  if (!fresh(cache.get(scopeKey))) {
    await once(scopeKey, () => loadLists(scopeKey, provider, endpoints, token, transport, guard, opts.signal));
  }
  const listed = cache.get(scopeKey)?.models.get(id);
  if (listed) return listed;

  const showKey = `${scopeKey}\0${id}`;
  if (!fresh(shown.get(showKey))) {
    await once(showKey, () => loadShow(showKey, provider, endpoints, token, id, transport, guard, opts.signal));
  }
  return shown.get(showKey)?.caps || null;
}

/**
 * Merge node-reported media support over static/default capabilities.
 * Never turns an existing capability off, and never overrides an explicit
 * operator custom-model override recorded in `caps.customKeys`.
 *
 * @param {object} caps Effective model capabilities.
 * @param {{ vision?: true, audioInput?: true, pdf?: true } | null} reported Node-reported modalities.
 * @returns {object}
 */
export function withNodeModalities(caps, reported) {
  if (!reported || !caps) return caps;
  const customKeys = caps.customKeys instanceof Set ? caps.customKeys : null;
  const out = { ...caps };
  for (const key of ["vision", "audioInput", "pdf"]) {
    if (reported[key] === true && !customKeys?.has(key)) out[key] = true;
  }
  if (customKeys) {
    Object.defineProperty(out, "customKeys", { value: customKeys, enumerable: false });
  }
  return out;
}

export function _resetNodeModalitiesCache() {
  cache.clear();
  shown.clear();
  inflight.clear();
}

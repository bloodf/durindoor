/**
 * Cursor live model catalog fetcher.
 *
 * Cursor exposes the account-specific model picker through the AgentService
 * `GetUsableModels` Connect RPC. Unlike the static provider registry, this
 * includes models newly enabled for the account and omits unavailable ones.
 */

import crypto from "crypto";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { PROVIDER_OAUTH } from "../providers/index.js";
import { buildCursorHeaders } from "../utils/cursorChecksum.js";
import { appendBoundedCursorChunk, decodeMessage } from "../utils/cursorProtobuf.js";
import { isNumber, isString, isObject } from "../../src/shared/utils/typeChecks.js";
import { connectHttp2, cursorProxyUrl } from "../utils/http2Connect.js";

import { readBoundedResponseText, sanitizeErrorMessage } from "../utils/error.js";

const MAX_CATALOG_BYTES = 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const NEGATIVE_CACHE_TTL_MS = 60 * 1000;

// agent.v1.ModelDetails protobuf field numbers.
const MODEL_ID_FIELD = 1;
const DISPLAY_MODEL_ID_FIELD = 3;
const DISPLAY_NAME_FIELD = 4;
const DISPLAY_NAME_SHORT_FIELD = 5;
const RESPONSE_MODELS_FIELD = 1;

// agent.v1.AvailableModels (response field 2) carries the model-picker flags
// AgentService honours: agent support, chat-only, hidden, and the account's
// default-on pick used to resolve the "Auto (Server Picks)" entry.
const RESPONSE_AVAILABLE_MODELS_FIELD = 2;
const AVAILABLE_MODEL_NAME_FIELD = 1;
const AVAILABLE_MODEL_DEFAULT_ON_FIELD = 2;
const AVAILABLE_MODEL_IS_CHAT_ONLY_FIELD = 4;
const AVAILABLE_MODEL_SUPPORTS_AGENT_FIELD = 5;
const AVAILABLE_MODEL_IS_HIDDEN_FIELD = 35;

/** @type {Map<string, { expiresAt: number, models: { id: string, name: string }[] }>} */
const catalogCache = new Map();
const negativeCache = new Map();

function getCursorModelsUrl() {
  const config = PROVIDER_OAUTH.cursor;
  if (!config?.agentEndpoint || !config?.modelsEndpoint) return null;
  return `${config.agentEndpoint.replace(/\/$/, "")}${config.modelsEndpoint}`;
}

function getAvailableModelsUrl() {
  const config = PROVIDER_OAUTH.cursor;
  if (!config?.apiEndpoint) return null;
  return `${config.apiEndpoint.replace(/\/$/, "")}/aiserver.v1.AiService/AvailableModels`;
}

function cacheKey(credentials, proxyUrl) {
  const seed = [
    credentials.providerSpecificData.machineId,
    credentials.accessToken,
    credentials.providerSpecificData.ghostMode !== false,
    getCursorModelsUrl(),
    getAvailableModelsUrl(),
    proxyUrl,
  ];
  return crypto.createHash("sha256").update(JSON.stringify(seed)).digest("hex");
}

function firstString(fields, fieldNumber) {
  const value = fields.get(fieldNumber)?.[0]?.value;
  if (!value || isNumber(value)) return "";
  return Buffer.from(value).toString("utf8");
}

function firstBool(fields, fieldNumber) {
  const value = fields.get(fieldNumber)?.[0]?.value;
  return value === 1;
}

/**
 * Decode Cursor's `agent.v1.GetUsableModelsResponse` protobuf payload.
 * The response contains repeated `agent.v1.ModelDetails` messages in field 1.
 */
export function parseCursorUsableModels(payload) {
  const response = decodeMessage(payload);
  const seen = new Set();
  const models = [];

  for (const entry of response.get(RESPONSE_MODELS_FIELD) || []) {
    if (!entry?.value || isNumber(entry.value)) continue;
    const detail = decodeMessage(entry.value);
    const id = firstString(detail, MODEL_ID_FIELD).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const name = (
      firstString(detail, DISPLAY_NAME_FIELD)
      || firstString(detail, DISPLAY_NAME_SHORT_FIELD)
      || firstString(detail, DISPLAY_MODEL_ID_FIELD)
      || id
    ).trim();
    models.push({ id, name });
  }

  return models;
}

/**
 * agent.api5.cursor.sh is HTTP/2-only; Node fetch/undici cannot speak h2.
 * Unary GetUsableModels uses an unframed protobuf body (application/proto).
 */
async function http2PostProto(url, headers, body, signal, timeoutMs, proxyUrl) {
  const client = await connectHttp2(url, { proxyUrl, timeoutMs, signal });
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const bodyState = { chunks: [], total: 0 };
    let responseHeaders = {};
    let settled = false;
    let req;
    let onAbort;

    const finish = (fn) => (...args) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (onAbort) signal?.removeEventListener("abort", onAbort);
      try { req?.destroy(); } catch {}
      try { client.destroy(); } catch {}
      fn(...args);
    };

    const timeoutId = setTimeout(finish(() => {
      reject(new Error("Cursor GetUsableModels timed out"));
    }), timeoutMs);

    client.on("error", finish(reject));

    req = client.request({
      ":method": "POST",
      ":path": urlObj.pathname,
      ":authority": urlObj.host,
      ":scheme": "https",
      ...headers,
    });

    req.on("response", (hdrs) => { responseHeaders = hdrs; });
    req.on("data", (chunk) => {
      if (settled) return;
      try {
        appendBoundedCursorChunk(bodyState, chunk, MAX_CATALOG_BYTES);
      } catch (error) {
        finish(reject)(error);
      }
    });
    req.on("end", finish(() => {
      resolve({
        status: Number(responseHeaders[":status"] || 0),
        body: Buffer.concat(bodyState.chunks, bodyState.total),
      });
    }));
    req.on("error", finish(reject));

    if (signal) {
      onAbort = finish(() => reject(new Error("Request aborted")));
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    req.end(body && body.length ? Buffer.from(body) : undefined);
  });
}

async function fetchCursorCatalog(credentials, signal, proxyOptions) {
  const accessToken = credentials?.accessToken;
  const machineId = credentials?.providerSpecificData?.machineId;
  const url = getCursorModelsUrl();
  if (!accessToken || !machineId || !url) return null;
  const proxyUrl = cursorProxyUrl(url, proxyOptions);

  const headers = {
    ...buildCursorHeaders(accessToken, machineId, credentials?.providerSpecificData?.ghostMode !== false),
    // Connect unary calls use an unframed protobuf body, unlike Cursor chat's
    // streaming `application/connect+proto` endpoint.
    accept: "application/proto",
    "content-type": "application/proto",
  };
  delete headers["connect-accept-encoding"];
  delete headers["connect-protocol-version"];

  const response = await http2PostProto(url, headers, new Uint8Array(), signal, FETCH_TIMEOUT_MS, proxyUrl);
  if (response.status !== 200) {
    const error = new Error(`Cursor GetUsableModels returned ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return mergeCursorModelFlags(parseCursorUsableModels(new Uint8Array(response.body)), response.body);
}

/** Normalize the JSON AvailableModels catalog used by Cursor's older endpoint. */
export function normalizeCursorAvailableModels(payload) {
  const root = payload && isObject(payload) ? payload : {};
  const nested = root.models && !Array.isArray(root.models) && isObject(root.models) ? root.models : {};
  const candidates = [payload, root.items, root.models, root.availableModels, root.available_models, root.model, nested.models, nested.items, nested.list].flatMap((value) => Array.isArray(value) ? value : []);
  const seen = new Set();
  const models = candidates.flatMap((entry) => {
    if (entry && isObject(entry) && (entry.disabled === true || entry.isDisabled === true || entry.usable === false || entry.isUsable === false)) return [];
    const id = (isString(entry) ? entry : [entry?.name, entry?.modelId, entry?.model_id, entry?.id, entry?.slug].find((value) => isString(value) && value.trim()))?.trim();
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const name = [entry?.displayName, entry?.display_name, entry?.title, entry?.label].find((value) => isString(value) && value.trim())?.trim() || id;
    const context = entry?.contextTokenLimit ?? entry?.context_token_limit;
    const definitions = entry?.parameterDefinitions ?? entry?.parameter_definitions;
    const efforts = new Set();
    for (const definition of Array.isArray(definitions) ? definitions : []) {
      if (!["effort", "reasoning"].includes(definition?.id)) continue;
      const type = definition.parameterType ?? definition.parameter_type;
      const options = type?.enumParameter?.values ?? type?.enum_parameter?.values;
      for (const option of Array.isArray(options) ? options : []) {
        if (!option?.blockedByAdminAllowlist && !option?.blocked_by_admin_allowlist && isString(option?.value) && option.value.trim()) efforts.add(option.value.trim());
      }
    }
    const model = { id, name };
    if (Number.isInteger(context) && context > 0) model.contextLength = context;
    if (efforts.size) model.supportedThinkingEfforts = [...efforts];
    return [model];
  });
  if (models.length && !seen.has("auto")) models.unshift({ id: "auto", name: "Auto" });
  return models;
}

async function fetchAvailableModels(credentials, signal, proxyOptions) {
  const url = getAvailableModelsUrl();
  if (!url) return null;
  const { machineId, ghostMode } = credentials.providerSpecificData;
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]) : AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const response = await proxyAwareFetch(url, {
    method: "POST",
    headers: { ...buildCursorHeaders(credentials.accessToken, machineId, ghostMode !== false), "content-type": "application/json", accept: "application/json" },
    body: "{}", redirect: "error", signal: requestSignal,
  }, proxyOptions);
  if (!response.ok || /proto/i.test(response.headers.get("content-type") || "")) {
    void response.body?.cancel().catch(() => {});
    return null;
  }
  const text = await readBoundedResponseText(response, { signal: requestSignal, maxBytes: MAX_CATALOG_BYTES, timeoutMs: FETCH_TIMEOUT_MS });
  return text ? normalizeCursorAvailableModels(JSON.parse(text)) : null;
}

/**
 * Attach model-picker flags (supportsAgent/defaultOn/…) from the response's
 * AvailableModels onto the usable-models list so callers can resolve the
 * auto/default entry. Only mutates when the server sent field 2, keeping the
 * parsed shape backward compatible.
 */
export function mergeCursorModelFlags(models, payload) {
  const available = parseCursorAvailableModels(payload);
  if (!available.length || !Array.isArray(models)) return models;
  const flagsById = new Map(available.map((model) => [model.id, model]));
  return models.map((model) => {
    const flags = flagsById.get(model.id);
    return flags ? { ...model, ...flags } : model;
  });
}

/**
 * Decode the current Cursor model-picker catalog (response field 2,
 * agent.v1.AvailableModels): the canonical AgentService model name plus the
 * picker flags needed to resolve "Auto (Server Picks)" to a real model.
 */
export function parseCursorAvailableModels(payload) {
  const response = decodeMessage(payload);
  const seen = new Set();
  const models = [];

  for (const entry of response.get(RESPONSE_AVAILABLE_MODELS_FIELD) || []) {
    if (!entry?.value || isNumber(entry.value)) continue;
    const fields = decodeMessage(entry.value);
    const id = firstString(fields, AVAILABLE_MODEL_NAME_FIELD).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);

    models.push({
      id,
      defaultOn: firstBool(fields, AVAILABLE_MODEL_DEFAULT_ON_FIELD),
      isChatOnly: firstBool(fields, AVAILABLE_MODEL_IS_CHAT_ONLY_FIELD),
      supportsAgent: firstBool(fields, AVAILABLE_MODEL_SUPPORTS_AGENT_FIELD),
      isHidden: firstBool(fields, AVAILABLE_MODEL_IS_HIDDEN_FIELD),
    });
  }

  return models;
}

/**
 * "Auto (Server Picks)" / "default" is not a real AgentService model id —
 * sending it verbatim makes Run come back empty. Resolve it to the account's
 * default agent-capable model so the server picks like the IDE does. Prefers
 * the picker's defaultOn model, then the first usable agent model.
 */
export function resolveAutoModelSelection(models) {
  if (!Array.isArray(models) || models.length === 0) return null;
  const usable = models.filter((model) => model.supportsAgent && !model.isChatOnly && !model.isHidden);
  if (usable.length === 0) return null;
  const preferred = usable.find((model) => model.defaultOn) || usable[0];
  return {
    modelId: preferred.id,
    matchedBy: "auto-default",
  };
}

/**
 * Resolve the live Cursor catalog for the authenticated account.
 * Returns null on any failure so callers can fall back to static models.
 */
export async function resolveCursorModels(credentials, options = {}) {
  if (!credentials?.accessToken || !credentials?.providerSpecificData?.machineId) {
    options.log?.debug?.("CURSOR_MODELS", "No Cursor access token or machine ID; skipping live fetch");
    return null;
  }

  const psd = credentials.providerSpecificData;
  const proxyOptions = options.proxyOptions || {
    connectionProxyEnabled: psd.connectionProxyEnabled,
    connectionProxyUrl: psd.connectionProxyUrl,
    connectionNoProxy: psd.connectionNoProxy,
    proxyPoolId: psd.connectionProxyPoolId,
    vercelRelayUrl: psd.vercelRelayUrl,
    strictProxy: psd.strictProxy,
  };
  let proxyUrl;
  try { proxyUrl = cursorProxyUrl(getCursorModelsUrl(), proxyOptions); } catch { return null; }
  const key = cacheKey(credentials, proxyUrl);
  const now = Date.now();
  if (!options.forceRefresh) {
    const cached = catalogCache.get(key);
    if (cached?.expiresAt > now) return { models: cached.models };
    // Failed lookups are cached briefly so /v1/models does not re-dial Cursor on every request.
    if (negativeCache.get(key) > now) return null;
  }

  try {
    let models;
    try { models = await fetchCursorCatalog(credentials, options.signal, proxyOptions); } catch (error) {
      if (options.signal?.aborted) throw error;
      models = null;
    }
    if (!models?.length) {
      const fallbackProxy = proxyUrl ? { ...proxyOptions, strictProxy: true } : proxyOptions;
      models = await fetchAvailableModels(credentials, options.signal, fallbackProxy);
    }
    if (!models?.length) {
      negativeCache.set(key, now + NEGATIVE_CACHE_TTL_MS);
      return null;
    }
    negativeCache.delete(key);
    catalogCache.set(key, { expiresAt: now + CACHE_TTL_MS, models });
    return { models };
  } catch (error) {
    if (!options.signal?.aborted) negativeCache.set(key, now + NEGATIVE_CACHE_TTL_MS);
    options.log?.warn?.("CURSOR_MODELS", `Live model fetch failed: ${sanitizeErrorMessage(error?.message || error)}`);
    return null;
  }
}

export function clearCursorModelCache() {
  catalogCache.clear();
  negativeCache.clear();
}

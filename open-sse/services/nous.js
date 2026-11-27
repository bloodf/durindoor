/**
 * Nous Research (Nous Portal) API-key provider — staged service.
 *
 * Port of decolua/9router #3363 at b08f006324ebc5e355a871fb46f8f5bd34f1acce
 * (`open-sse/services/nous.js` and the Nous branches of the models, test and
 * validate routes). Nous Research is already registered as `nous-research`
 * (alias `nous`); these source-backed additions for it are staged. Their
 * data-only metadata is `open-sse/providers/staging/nous.json`, outside the
 * registry scan, and nothing in production imports this module until auth
 * promotes it. Registration requirements are recorded in
 * `internal/docs/port-reports/9router-3363-nous-registration-manifest.json`.
 *
 * Deliberate differences from the source:
 * - Key verification. The source proves a key with a one-token chat request
 *   against a free model. That is inference, so it is not used here. Nous
 *   serves `/models` without authentication and documents no other read-only
 *   authenticated endpoint, so a well-formed key is saved unverified and the
 *   network is never contacted to verify it.
 * - The public model catalogue is fetched without the API key, so the key is
 *   never sent anywhere except the chat endpoint.
 * - Provider identity. The source registers `id: "nous"`; DurinDoor already
 *   serves Nous Research as `nous-research` (alias `nous`), so this staged
 *   work extends that provider instead of adding a second one.
 * - Thinking is shaped here, from the existing intent extraction in
 *   `translator/concerns/thinkingUnified.js`, rather than through a new shared
 *   `thinkingFormat`. Registration decides whether to promote it.
 *
 * Real-provider behaviour is unverified: every contract below is from the
 * pinned source and is exercised only against offline mocks.
 */
import { DefaultExecutor } from "../executors/default.js";
import { DEFAULT_CAPABILITIES } from "../providers/capabilities.js";
import { budgetToLevel } from "../translator/concerns/thinking.js";
import { captureThinking, clampTierToSupported, parseSuffix } from "../translator/concerns/thinkingUnified.js";
import { FORMATS } from "../translator/formats.js";
import { translateRequest } from "../translator/index.js";
import { readBoundedResponseText } from "../utils/error.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

/**
 * Canonical provider ID. DurinDoor already registers Nous Research as
 * `nous-research` with alias `nous` (registry/nous-research.js, OmniRoute port
 * #980). The source's `id: "nous"` with alias `nous-research` is the inverse
 * and would collide with both, so the existing identity is kept.
 */
export const NOUS_PROVIDER_ID = "nous-research";
export const NOUS_PROVIDER_ALIAS = "nous";
/** Source (decolua/9router #3363) provider ID, recorded for the registration manifest. */
export const NOUS_SOURCE_PROVIDER_ID = "nous";
export const NOUS_INFERENCE_ORIGIN = "https://inference-api.nousresearch.com";
export const NOUS_INFERENCE_BASE_URL = `${NOUS_INFERENCE_ORIGIN}/v1`;
export const NOUS_CHAT_COMPLETIONS_URL = `${NOUS_INFERENCE_BASE_URL}/chat/completions`;
export const NOUS_MODELS_URL = `${NOUS_INFERENCE_BASE_URL}/models`;
export const NOUS_API_KEY_URL = "https://portal.nousresearch.com/api-keys";

/**
 * Routed model IDs carry the existing `nous` alias as prefix so the vendor
 * namespace (`nousresearch/…`) is not read as a provider.
 */
export const NOUS_MODEL_PREFIX = `${NOUS_PROVIDER_ALIAS}/`;

const NOUS_CATALOG_TIMEOUT_MS = 10_000;
const NOUS_CATALOG_MAX_BYTES = 4 * 1024 * 1024;
const NOUS_API_KEY_MAX_LENGTH = 4096;

/** Seed models from the source registry entry. */
export const NOUS_SEED_MODELS = Object.freeze([
  Object.freeze({ id: "nousresearch/hermes-4-70b", name: "Nous: Hermes 4 70B", contextLength: 131072 }),
  Object.freeze({ id: "nousresearch/hermes-4-405b", name: "Nous: Hermes 4 405B", contextLength: 131072 }),
]);

/** Effort tiers the Nous wire accepts (source: `nous: L.base` in thinkingLevels.js). */
export const NOUS_THINKING_LEVELS = Object.freeze(["none", "low", "medium", "high"]);
const NOUS_REASONING_TIERS = NOUS_THINKING_LEVELS.filter((level) => level !== "none");
const KNOWN_TIERS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);

/**
 * Per-model capability rows (source: PROVIDER_CAPABILITIES.nous). The Hermes 4
 * catalogue does not advertise tools; reasoning is a nested object.
 */
export const NOUS_MODEL_CAPABILITIES = Object.freeze({
  "nousresearch/hermes-4-70b": Object.freeze({ tools: false, reasoning: true, thinkingFormat: "nous", thinkingEfforts: NOUS_THINKING_LEVELS, contextWindow: 131072, maxOutput: 32000 }),
  "nousresearch/hermes-4-405b": Object.freeze({ tools: false, reasoning: true, thinkingFormat: "nous", thinkingEfforts: NOUS_THINKING_LEVELS, contextWindow: 131072, maxOutput: 32000 }),
});

// Every field a client or a translator may use to ask for thinking. Nous reads
// only `reasoning`, so the rest are removed before the Nous shape is written.
const THINKING_FIELDS = ["reasoning", "reasoning_effort", "reasoningEffort", "thinking", "enable_thinking", "thinking_budget", "think"];

const asPositiveInteger = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Upstream model ID for a routed or suffixed model name: drops a `model(level)`
 * suffix and one leading `nous/` prefix.
 * @param {string} model
 * @returns {string}
 */
export function toNousUpstreamModelId(model) {
  const { cleanModel } = parseSuffix(typeof model === "string" ? model.trim() : "");
  return cleanModel.startsWith(NOUS_MODEL_PREFIX) ? cleanModel.slice(NOUS_MODEL_PREFIX.length) : cleanModel;
}

/**
 * Capabilities for a Nous model. Models outside the declared rows (third-party
 * entries in the live catalogue) get the defaults, so they never receive a
 * reasoning field.
 * @param {string} model
 */
export function getNousModelCapabilities(model) {
  const row = NOUS_MODEL_CAPABILITIES[toNousUpstreamModelId(model)];
  return { ...DEFAULT_CAPABILITIES, ...(row || {}) };
}

/** Thinking levels the UI may offer for a Nous model, or null when it cannot reason. */
export function getNousThinkingLevels(model) {
  return getNousModelCapabilities(model).reasoning ? [...NOUS_THINKING_LEVELS] : null;
}

// ─── Live catalogue ──────────────────────────────────────────────────────────

const isTextCapable = (model) => {
  const outputModalities = model?.architecture?.output_modalities;
  return !Array.isArray(outputModalities) || outputModalities.length === 0 || outputModalities.includes("text");
};

const getRawModels = (payload) => {
  const models = Array.isArray(payload) ? payload : payload?.data || payload?.models || payload?.results || [];
  return Array.isArray(models) ? models.filter(isPlainObject) : [];
};

/**
 * True only for an explicit zero price: the number 0 or a decimal zero string
 * ("0", "0.0", " 0.000 "). Booleans, arrays, objects, blanks and other
 * malformed values fail closed, so they are never offered as free.
 */
const isZeroPrice = (value) => {
  if (typeof value === "number") return value === 0;
  if (typeof value === "string") return /^0+(?:\.0+)?$/.test(value.trim());
  return false;
};

/**
 * Normalize the OpenAI-style Nous catalogue. Embedding and image-only entries
 * are dropped; first-party `nousresearch/` models sort first, upstream order
 * is kept within each group, and duplicate IDs keep their first entry.
 * @param {unknown} payload
 * @returns {{ id: string, name: string, contextLength?: number, maxOutputTokens?: number, description?: string }[]}
 */
export function normalizeNousModels(payload) {
  const seen = new Set();
  return getRawModels(payload)
    .filter(isTextCapable)
    .map((model) => {
      const id = typeof model.id === "string" ? model.id.trim() : "";
      if (!id || seen.has(id)) return null;
      seen.add(id);
      const contextLength = asPositiveInteger(model.context_length ?? model.top_provider?.context_length);
      const maxOutputTokens = asPositiveInteger(model.top_provider?.max_completion_tokens);
      const name = typeof model.name === "string" && model.name.trim() ? model.name : id;
      return {
        id,
        name,
        ...(contextLength ? { contextLength } : {}),
        ...(maxOutputTokens ? { maxOutputTokens } : {}),
        ...(typeof model.description === "string" && model.description ? { description: model.description } : {}),
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(!a.id.startsWith("nousresearch/")) - Number(!b.id.startsWith("nousresearch/")));
}

/**
 * Live catalogue as routed models: IDs gain the `nous/` prefix and keep the
 * upstream ID in `upstreamModelId` (source: normalizeRoutedNousModels).
 */
export function normalizeRoutedNousModels(payload) {
  return normalizeNousModels(payload).map((model) => ({
    ...model,
    id: `${NOUS_MODEL_PREFIX}${model.id}`,
    upstreamModelId: model.id,
  }));
}

/**
 * Zero-cost text models with at least 200K context (source: the `nous-free`
 * suggested-models filter).
 */
export function normalizeNousFreeModels(payload) {
  const freeModels = getRawModels(payload).filter((model) => {
    const contextLength = asPositiveInteger(model.context_length ?? model.top_provider?.context_length);
    return isTextCapable(model) &&
      isZeroPrice(model.pricing?.prompt) &&
      isZeroPrice(model.pricing?.completion) &&
      contextLength >= 200000;
  });
  return normalizeNousModels(freeModels);
}

/** Error raised by the catalogue fetch; carries the HTTP status when there is one. */
export class NousCatalogError extends Error {
  constructor(message, { status = null, code } = {}) {
    super(message);
    this.name = "NousCatalogError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Fetch the live catalogue through the selected connection's proxy route.
 * The endpoint is public, so no credential is sent; redirects are refused.
 * @param {{ proxyOptions?: object|null, signal?: AbortSignal, routed?: boolean }} [options]
 */
export async function fetchNousModels({ proxyOptions = null, signal, routed = true } = {}) {
  const timeout = AbortSignal.timeout(NOUS_CATALOG_TIMEOUT_MS);
  const response = await proxyAwareFetch(NOUS_MODELS_URL, {
    method: "GET",
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  }, proxyOptions);
  if (!response.ok) {
    try { await response.body?.cancel?.(); } catch { /* already closed */ }
    throw new NousCatalogError(`Nous model catalogue returned HTTP ${response.status}`, { status: response.status, code: "catalog_http_error" });
  }
  const text = await readBoundedResponseText(response, { maxBytes: NOUS_CATALOG_MAX_BYTES, timeoutMs: NOUS_CATALOG_TIMEOUT_MS, signal });
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new NousCatalogError("Nous model catalogue returned malformed JSON", { code: "catalog_malformed" });
  }
  if (!Array.isArray(payload) && !isPlainObject(payload)) {
    throw new NousCatalogError("Nous model catalogue returned an unexpected payload", { code: "catalog_malformed" });
  }
  return routed ? normalizeRoutedNousModels(payload) : normalizeNousModels(payload);
}

// ─── Credential verification ────────────────────────────────────────────────

/**
 * Nous exposes no authenticated, read-only, non-billable endpoint: `/models`
 * is public and the source's probe is a chat completion. Verification is
 * therefore unsupported and keys are saved unverified.
 */
export const NOUS_KEY_VERIFICATION = Object.freeze({
  supported: false,
  status: "saved-unverified",
  reason: "Nous serves /models without authentication and documents no read-only authenticated endpoint; the only proof of a key is inference, which is never used to test a key.",
});

/**
 * Check a submitted key locally. Never contacts the network.
 * @param {unknown} apiKey
 * @returns {{ ok: true, apiKey: string } | { ok: false, error: string }}
 */
export function checkNousApiKeyShape(apiKey) {
  if (typeof apiKey !== "string") return { ok: false, error: "API key required" };
  const key = apiKey.trim();
  if (!key) return { ok: false, error: "API key required" };
  if (key.length > NOUS_API_KEY_MAX_LENGTH) return { ok: false, error: "API key is too long" };
  // Header-safe: visible ASCII only, no internal whitespace.
  if (!/^[\x21-\x7E]+$/.test(key)) return { ok: false, error: "API key contains invalid characters" };
  return { ok: true, apiKey: key };
}

/**
 * Validation result for the add-connection flow. A well-formed key is
 * accepted as saved-unverified; nothing is sent to Nous.
 * @param {unknown} apiKey
 */
export function verifyNousApiKey(apiKey) {
  const shape = checkNousApiKeyShape(apiKey);
  if (!shape.ok) return { valid: false, verified: false, status: "rejected", error: shape.error };
  return {
    valid: true,
    skipped: true,
    verified: false,
    status: NOUS_KEY_VERIFICATION.status,
    error: null,
    note: "Saved without verification: Nous has no read-only authenticated check, and inference is never used to test a key.",
  };
}

/**
 * Result for testing a saved connection. Uses only the selected connection,
 * never contacts the network, and never reports the key as verified.
 * @param {{ provider?: string, apiKey?: unknown }} connection
 */
export function testNousConnection(connection) {
  if (connection?.provider !== NOUS_PROVIDER_ID) {
    return { valid: false, verified: false, status: "rejected", error: "Not a Nous connection" };
  }
  return verifyNousApiKey(connection.apiKey);
}

/**
 * Save a Nous API-key connection. The key is checked locally first; `persist`
 * runs only for a well-formed key and receives a record marked unverified.
 * @param {{ apiKey: unknown, name?: string }} input
 * @param {{ persist: (record: object) => Promise<object>|object }} store
 */
export async function saveNousConnection(input, { persist }) {
  const verification = verifyNousApiKey(input?.apiKey);
  if (!verification.valid) return { saved: false, verification };
  const record = {
    provider: NOUS_PROVIDER_ID,
    authType: "apikey",
    apiKey: checkNousApiKeyShape(input.apiKey).apiKey,
    ...(typeof input.name === "string" && input.name.trim() ? { name: input.name.trim() } : {}),
    testStatus: "unknown",
    lastError: null,
  };
  const connection = await persist(record);
  return { saved: true, verification, connection };
}

// ─── Request shaping ────────────────────────────────────────────────────────

/** Nous wire effort for a unified thinking intent, or null to omit `reasoning`. */
function nousEffort(intent, caps) {
  if (!intent) return null;
  const canDisable = caps.thinkingCanDisable !== false;
  if (intent.mode === "none") return canDisable ? null : NOUS_REASONING_TIERS[0];
  let level = intent.mode === "level" ? String(intent.level || "").toLowerCase()
    : intent.mode === "budget" ? budgetToLevel(intent.budget) || "medium"
      : "medium";
  if (!KNOWN_TIERS.has(level) || level === "auto") level = "medium";
  if (level === "none") return canDisable ? null : NOUS_REASONING_TIERS[0];
  return clampTierToSupported(level, NOUS_REASONING_TIERS);
}

/** Nous-native `reasoning: { enabled }` without an effort is an intent too. */
function nativeReasoningIntent(body) {
  const reasoning = body?.reasoning;
  if (!isPlainObject(reasoning) || typeof reasoning.enabled !== "boolean") return null;
  if (!reasoning.enabled) return { mode: "none" };
  return typeof reasoning.effort === "string" && reasoning.effort ? { mode: "level", level: reasoning.effort } : { mode: "auto" };
}

/**
 * Resolve the thinking intent for a Nous request: a `model(level)` suffix
 * wins, then an explicit intent, then the body's own fields.
 */
export function resolveNousThinkingIntent(model, body, intent = undefined) {
  const { override } = parseSuffix(typeof model === "string" ? model : "");
  if (override) return override;
  if (intent !== undefined) return intent;
  const upstream = toNousUpstreamModelId(model);
  return nativeReasoningIntent(body) ?? captureThinking(body, upstream, null, getNousModelCapabilities(upstream));
}

/**
 * Build the Nous Chat Completions body from an OpenAI-format body. Does not
 * mutate the input. Reasoning models get `reasoning: { enabled, effort }` or
 * no field when disabled; every other thinking field is removed.
 * @param {string} model routed or upstream model name
 * @param {object} body OpenAI Chat Completions body
 * @param {{ intent?: object|null, stream?: boolean }} [options]
 */
export function buildNousChatBody(model, body, { intent = undefined, stream } = {}) {
  const upstream = toNousUpstreamModelId(model);
  const caps = getNousModelCapabilities(upstream);
  const resolved = resolveNousThinkingIntent(model, body, intent);
  const out = { ...(isPlainObject(body) ? body : {}), model: upstream };
  for (const field of THINKING_FIELDS) delete out[field];
  if (typeof stream === "boolean") out.stream = stream;
  if (caps.reasoning) {
    const effort = nousEffort(resolved, caps);
    if (effort) out.reasoning = { enabled: true, effort };
  }
  return out;
}

// Capabilities handed to the shared translator so it strips every thinking
// field: the Nous shape is written by buildNousChatBody from the captured intent.
const TRANSLATE_WITHOUT_THINKING = Object.freeze({ ...DEFAULT_CAPABILITIES, reasoning: false });

/**
 * Translate a client request (OpenAI, Claude, Responses, …) to the Nous wire
 * through the shared translator. The thinking intent is captured from the
 * client body before translation, as chatCore does.
 * @param {string} sourceFormat a FORMATS value
 * @param {string} model routed or upstream model name
 * @param {object} body client request body
 * @param {{ stream?: boolean }} [options]
 */
export function translateToNousRequest(sourceFormat, model, body, { stream = false } = {}) {
  const upstream = toNousUpstreamModelId(model);
  const intent = resolveNousThinkingIntent(model, body);
  const translated = translateRequest(sourceFormat, FORMATS.OPENAI, upstream, body, stream, null, null, null, [], null, null, {
    capabilityModel: upstream,
    modelCapabilities: TRANSLATE_WITHOUT_THINKING,
    thinkingIntent: intent ?? null,
  });
  return buildNousChatBody(upstream, translated, { intent: intent ?? null, stream });
}

/**
 * Staged executor for the existing `nous-research` provider. It extends the
 * registered DefaultExecutor, so the registry endpoint, auth descriptor,
 * Nous attribution tags, proxy routing and redirect refusal are unchanged; it
 * only adds the source's Nous request shaping and refuses to send without a
 * well-formed API key. It is not in the executor map.
 */
export class NousExecutor extends DefaultExecutor {
  constructor() {
    super(NOUS_PROVIDER_ID);
  }

  // The transport is fixed: Base/DefaultExecutor honour credentials.runtimeTransport
  // (baseUrl, urlSuffix, headers, auth, and format for wire handling such as
  // OpenAI tool-error normalization), which could send the selected key
  // elsewhere or change the wire. The staged executor drops it once, before
  // the inherited execution path; the caller's object is not modified.
  execute(args = {}) {
    return super.execute({ ...args, credentials: withoutRuntimeTransport(args.credentials) });
  }

  buildUrl() {
    return NOUS_CHAT_COMPLETIONS_URL;
  }

  buildHeaders(credentials, ...rest) {
    if (!checkNousApiKeyShape(credentials?.apiKey).ok) throw new Error("Nous connection has no usable API key");
    return super.buildHeaders(withoutRuntimeTransport(credentials), ...rest);
  }

  transformRequest(model, body, stream, credentials, requestContext = null) {
    const shaped = buildNousChatBody(model, body, { intent: requestContext?.thinkingIntent, stream });
    return super.transformRequest(shaped.model, shaped, stream, withoutRuntimeTransport(credentials), requestContext, NOUS_CHAT_COMPLETIONS_URL);
  }
}

/** Selected connection credentials without a runtime transport override. */
function withoutRuntimeTransport(credentials) {
  if (!credentials || !("runtimeTransport" in credentials)) return credentials;
  const { runtimeTransport: _ignored, ...rest } = credentials;
  return rest;
}

export function createNousExecutor() {
  return new NousExecutor();
}

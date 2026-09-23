import { extractLiveModelLimits } from "open-sse/services/liveModelLimits.js";
import { isBoolean, isNumber, isObject, isString } from "../../shared/utils/typeChecks.js";

/**
 * Pure helpers for model auto-sync: which providers sync by default, how a
 * raw list-models entry becomes a catalog row, and how a fresh fetch merges
 * into the stored catalog. No I/O here; see runner.js for the fetch side.
 */

/** Providers whose catalogs auto-update unless the operator turns them off. */
export const MODEL_AUTO_SYNC_DEFAULT_PROVIDERS = Object.freeze([
  "openai", "anthropic", "claude", "xai", "gemini", "codex", "github"
]);

export const DEFAULT_MODEL_AUTO_SYNC_INTERVAL_HOURS = 24;
export const MAX_MODEL_AUTO_SYNC_INTERVAL_HOURS = 720;

const isRecord = (value) => value !== null && isObject(value) && !Array.isArray(value);

/**
 * Auto-sync is on for a provider when the operator enabled it explicitly, or
 * when it is one of the default providers and was not turned off.
 * @param {string} providerId
 * @param {object|null} settings
 */
export function isModelAutoSyncEnabled(providerId, settings) {
  const overrides = isRecord(settings?.modelAutoSyncProviders) ? settings.modelAutoSyncProviders : {};
  if (isBoolean(overrides[providerId])) return overrides[providerId];
  return MODEL_AUTO_SYNC_DEFAULT_PROVIDERS.includes(providerId);
}

/** Interval in hours; 0 turns the scheduler off. Invalid values use the default. */
export function getModelAutoSyncIntervalHours(settings) {
  const value = settings?.modelAutoSyncIntervalHours;
  if (Number.isInteger(value) && value >= 0 && value <= MAX_MODEL_AUTO_SYNC_INTERVAL_HOURS) return value;
  return DEFAULT_MODEL_AUTO_SYNC_INTERVAL_HOURS;
}

/**
 * Validate the auto-sync keys of a settings PATCH body.
 * @returns {string|null} an error message, or null when valid
 */
export function validateModelAutoSyncSettingsPatch(body) {
  if (Object.prototype.hasOwnProperty.call(body, "modelAutoSyncIntervalHours")) {
    const v = body.modelAutoSyncIntervalHours;
    if (!Number.isInteger(v) || v < 0 || v > MAX_MODEL_AUTO_SYNC_INTERVAL_HOURS) return "Invalid modelAutoSyncIntervalHours";
  }
  if (Object.prototype.hasOwnProperty.call(body, "modelAutoSyncProviders")) {
    const map = body.modelAutoSyncProviders;
    if (!isRecord(map)) return "Invalid modelAutoSyncProviders";
    for (const [id, on] of Object.entries(map)) {
      if (!id.trim() || !isBoolean(on)) return "Invalid modelAutoSyncProviders";
    }
  }
  return null;
}

// Service kinds come from buildModelsList's MODEL_TYPE_TO_KIND. `null` means
// the model has no service in this gateway and is left out of the catalog.
const KIND_RULES = [
  [/moderation|realtime/, null],
  [/rerank/, "rerank"],
  [/embed/, "embedding"],
  [/whisper|transcribe|(^|[-_])stt([-_]|$)/, "stt"],
  [/(^|[-_])tts([-_]|$)|speech/, "tts"],
  [/dall-?e|gpt-image|imagen|image-generation|(^|[-_])image([-_]|$)|imagine/, "image"],
  [/(^|[-_])veo|sora/, "video"]
];
const EXPLICIT_KINDS = new Set(["image", "tts", "embedding", "stt", "rerank", "video"]);

/**
 * Service kind for a listed model: "llm" for chat models, a media kind for
 * embeddings/tts/stt/image/video/rerank, or null for models this gateway has
 * no route for (moderation, realtime-only).
 * @param {string} id
 * @param {object} [raw] - the provider's list-models entry
 * @returns {string|null}
 */
export function classifyModelKind(id, raw = {}) {
  if (EXPLICIT_KINDS.has(raw?.type)) return raw.type;
  const methods = Array.isArray(raw?.supportedGenerationMethods) ? raw.supportedGenerationMethods : null;
  const lower = String(id).toLowerCase();
  for (const [pattern, kind] of KIND_RULES) {
    if (pattern.test(lower)) return kind;
  }
  // Gemini lists generation methods; embed-only models are embeddings and
  // models without generateContent (aqa, live-only) cannot serve chat.
  if (methods) {
    if (methods.includes("generateContent")) return "llm";
    if (methods.includes("embedContent")) return "embedding";
    return null;
  }
  return "llm";
}

function rawModelId(raw) {
  const value = [raw?.id, raw?.slug, raw?.model, raw?.name].find((v) => isString(v) && v.trim());
  return value ? value.trim().replace(/^models\//, "") : "";
}

function rawModelName(raw, id) {
  const value = [raw?.display_name, raw?.displayName, raw?.name].find((v) => isString(v) && v.trim());
  return value && value.replace(/^models\//, "") !== id ? value.trim() : id;
}

function positiveInt(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

/**
 * Capabilities the provider API itself states. Pattern-table capabilities are
 * layered underneath at /v1/models time by buildModelsList, so this only
 * records what the listing proves.
 */
export function extractApiCapabilities(raw) {
  if (!isRecord(raw)) return {};
  const caps = { ...extractLiveModelLimits(raw) };
  // Gemini
  caps.contextWindow ??= positiveInt(raw.inputTokenLimit);
  caps.maxOutput ??= positiveInt(raw.outputTokenLimit);
  if (raw.thinking === true) caps.reasoning = true;
  // Qoder / Kimi web style flags
  caps.contextWindow ??= positiveInt(raw.contextLength);
  caps.maxOutput ??= positiveInt(raw.maxOutputTokens);
  if (raw.isVL === true) caps.vision = true;
  if (raw.isReasoning === true || raw.supportsReasoning === true) caps.reasoning = true;

  const apiCaps = isRecord(raw.capabilities) ? raw.capabilities : null;
  if (apiCaps) {
    // GitHub Copilot: { limits: {...}, supports: {...} }
    const limits = isRecord(apiCaps.limits) ? apiCaps.limits : {};
    caps.contextWindow ??= positiveInt(limits.max_context_window_tokens) ?? positiveInt(limits.max_prompt_tokens);
    caps.maxOutput ??= positiveInt(limits.max_output_tokens);
    const supports = isRecord(apiCaps.supports) ? apiCaps.supports : {};
    if (isBoolean(supports.vision)) caps.vision = supports.vision;
    if (isBoolean(supports.tool_calls)) caps.tools = supports.tool_calls;
    // Anthropic: { image_input: { supported }, pdf_input: {...}, thinking: {...} }
    const supported = (key) => isRecord(apiCaps[key]) && isBoolean(apiCaps[key].supported) ? apiCaps[key].supported : undefined;
    if (supported("image_input") !== undefined) caps.vision = supported("image_input");
    if (supported("pdf_input") !== undefined) caps.pdf = supported("pdf_input");
    if (supported("thinking") !== undefined) caps.reasoning = supported("thinking");
  }
  for (const key of Object.keys(caps)) if (caps[key] === undefined) delete caps[key];
  return caps;
}

/**
 * Turn a provider's raw list-models response into catalog rows. Drops models
 * without a gateway route and de-duplicates ids.
 * @param {object[]} rawModels
 * @returns {{ id: string, name: string, kind: string, capabilities?: object }[]}
 */
export function normalizeSyncedModels(rawModels) {
  if (!Array.isArray(rawModels)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of rawModels) {
    const entry = isString(raw) ? { id: raw } : raw;
    if (!isRecord(entry)) continue;
    // Codex review variants are synthesized by the fetcher and only route
    // through their registry rows (upstreamModelId), so they are not synced.
    if (entry.quotaFamily === "review" && entry.upstreamModelId) continue;
    const id = rawModelId(entry);
    if (!id || seen.has(id)) continue;
    const kind = classifyModelKind(id, entry);
    if (!kind) continue;
    seen.add(id);
    const capabilities = extractApiCapabilities(entry);
    out.push({
      id,
      name: rawModelName(entry, id),
      kind,
      ...(Object.keys(capabilities).length ? { capabilities } : null)
    });
  }
  return out;
}

/**
 * Static registry rows that a synced list keeps: Codex review variants route
 * through their registry row and are never listed by the API, so they stay
 * while their base model (upstreamModelId) is in the fetched list.
 */
function derivedStaticModels(staticModels, ids) {
  return (staticModels || []).filter((m) => m?.quotaFamily === "review" && isString(m.upstreamModelId) &&
  ids.has(m.upstreamModelId) && !ids.has(m.id));
}

/**
 * The provider's effective model list while auto-sync is on: exactly what
 * the last successful fetch returned (after the chat/non-chat filtering),
 * plus derived registry variants. Returns null when there is no successful
 * catalog yet, so callers keep the static registry. Custom models are not
 * part of this list; callers always add them on top.
 * @param {object|null} entry - stored catalog entry
 * @param {object[]} staticModels - the provider's registry models
 * @returns {{ id: string, name: string, kind: string, capabilities?: object }[]|null}
 */
export function effectiveSyncedModels(entry, staticModels = []) {
  const models = Array.isArray(entry?.models) ? entry.models.filter((m) => isString(m?.id)) : [];
  if (!entry?.syncedAt || models.length === 0) return null;
  const ids = new Set(models.map((m) => m.id));
  const derived = derivedStaticModels(staticModels, ids).map((m) => ({ id: m.id, name: m.name || m.id, kind: m.kind || m.type || "llm" }));
  return [...models, ...derived];
}

/**
 * Merge a successful, non-empty fetch into the stored catalog. The fetched
 * list replaces the previous one. `newModelIds` and `removedModelIds` compare
 * against the previous effective list: the last synced catalog, or the static
 * registry on the first sync.
 *
 * @param {object|null} previous - stored entry, if any
 * @param {object[]} fetched - normalizeSyncedModels() output (non-empty)
 * @param {{ now: number, staticModels?: object[], connectionId?: string }} options
 */
export function mergeSyncedCatalog(previous, fetched, { now, staticModels = [], connectionId = null }) {
  const at = new Date(now).toISOString();
  const before = effectiveSyncedModels(previous, staticModels) ||
  staticModels.filter((m) => isString(m?.id) && !(m.quotaFamily === "review" && m.upstreamModelId));
  const beforeIds = new Set(before.map((m) => m.id));
  const fetchedIds = new Set(fetched.map((m) => m.id));
  const keptDerived = new Set(derivedStaticModels(staticModels, fetchedIds).map((m) => m.id));
  return {
    syncedAt: at,
    lastAttemptAt: at,
    connectionId,
    error: null,
    newModelIds: [...fetchedIds].filter((id) => !beforeIds.has(id)),
    removedModelIds: [...beforeIds].filter((id) => !fetchedIds.has(id) && !keptDerived.has(id)),
    models: fetched
  };
}

/**
 * Record a failed attempt. The previous catalog, and with it the effective
 * model list, is kept unchanged.
 */
export function markSyncFailure(previous, message, now) {
  return {
    models: [],
    newModelIds: [],
    removedModelIds: [],
    syncedAt: null,
    ...(previous || {}),
    lastAttemptAt: new Date(now).toISOString(),
    error: String(message || "Sync failed")
  };
}

/**
 * Combo members and model aliases that point at a model the effective synced
 * list no longer has. Routing is untouched (the request still goes upstream),
 * so these are reported, never rewritten.
 *
 * @param {{ providers: { aliases: string[], ids: Set<string>, customIds: Set<string> }[], combos?: object[], modelAliases?: object }} input
 * @returns {{ combos: Record<string, string[]>, aliases: Record<string, string> }}
 */
export function findPrunedReferences({ providers, combos = [], modelAliases = {} }) {
  const isPruned = (ref) => {
    if (!isString(ref)) return false;
    const slash = ref.indexOf("/");
    if (slash <= 0) return false;
    const prefix = ref.slice(0, slash);
    const modelId = ref.slice(slash + 1);
    return providers.some((p) => p.aliases.includes(prefix) && !p.ids.has(modelId) && !p.customIds.has(modelId));
  };
  const out = { combos: {}, aliases: {} };
  for (const combo of combos) {
    const members = (Array.isArray(combo?.models) ? combo.models : []).filter(isPruned);
    if (members.length && isString(combo.name)) out.combos[combo.name] = members;
  }
  for (const [alias, target] of Object.entries(isRecord(modelAliases) ? modelAliases : {})) {
    if (isPruned(target)) out.aliases[alias] = target;
  }
  return out;
}

/** True when the provider's last attempt is older than the interval. */
export function isSyncDue(entry, intervalHours, now) {
  if (!isNumber(intervalHours) || intervalHours <= 0) return false;
  const last = Date.parse(entry?.lastAttemptAt || "");
  if (!Number.isFinite(last)) return true;
  return now - last >= intervalHours * 60 * 60 * 1000;
}

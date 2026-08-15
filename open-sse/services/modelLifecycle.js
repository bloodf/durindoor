// Provider-scoped model lifecycle policy.
//
// Replacement model IDs are migration guidance only. This module never rewrites
// a request: shutdown models are rejected, deprecated models remain callable
// until their shutdown date, and untracked models pass through unchanged.

export const OPENAI_MODEL_DEPRECATIONS_URL =
  "https://developers.openai.com/api/docs/deprecations";

/**
 * @typedef {"untracked" | "deprecated" | "shutdown"} ModelLifecycleStatus
 * @typedef {"allow" | "warn" | "reject"} ModelLifecycleAction
 * @typedef {"audio" | "computer-use" | "deep-research" | "realtime" | "search" | "speech" | "text"} ModelLifecycleKind
 *
 * @typedef {Object} ModelLifecycleReplacement
 * @property {string} provider
 * @property {string} model
 * @property {string} [notes]
 *
 * @typedef {Object} ModelLifecycleRecord
 * @property {string} provider
 * @property {string} model
 * @property {string} shutdownAt
 * @property {ModelLifecycleReplacement | null} replacement
 * @property {ModelLifecycleKind} kind
 * @property {string} source
 *
 * @typedef {Object} ModelLifecycleDecision
 * @property {string} provider
 * @property {string} model
 * @property {ModelLifecycleStatus} status
 * @property {ModelLifecycleAction} action
 * @property {string | null} shutdownAt
 * @property {ModelLifecycleReplacement | null} replacement
 * @property {string | null} source
 */

const OPENAI_SOURCE = OPENAI_MODEL_DEPRECATIONS_URL;

/**
 * @param {string} model
 * @param {string} shutdownAt
 * @param {string | null} replacement
 * @param {ModelLifecycleKind} kind
 * @param {string} [notes]
 * @returns {ModelLifecycleRecord}
 */
function openAiRecord(model, shutdownAt, replacement, kind, notes) {
  return {
    provider: "openai",
    model,
    shutdownAt,
    replacement: replacement
      ? { provider: "openai", model: replacement, ...(notes ? { notes } : {}) }
      : null,
    kind,
    source: OPENAI_SOURCE,
  };
}

/**
 * Unambiguous shutdowns from the official OpenAI deprecations page, verified
 * 2026-07-26. The page lists gpt-4-1106-preview with conflicting shutdown dates,
 * so that model is intentionally omitted until the upstream conflict is resolved.
 */
export const MODEL_LIFECYCLE_RECORDS = Object.freeze([
  openAiRecord("computer-use-preview-2025-03-11", "2026-07-23", "gpt-5.6-terra", "computer-use"),
  openAiRecord("computer-use-preview", "2026-07-23", "gpt-5.6-terra", "computer-use"),
  openAiRecord("gpt-4o-mini-search-preview-2025-03-11", "2026-07-23", "gpt-5.6-terra", "search"),
  openAiRecord("gpt-4o-search-preview-2025-03-11", "2026-07-23", "gpt-5.6-terra", "search"),
  openAiRecord("gpt-4o-mini-tts-2025-03-20", "2026-07-23", "gpt-4o-mini-tts-2025-12-15", "speech"),
  openAiRecord("gpt-5-chat-latest", "2026-07-23", "gpt-5.6-sol", "text"),
  openAiRecord("gpt-5-codex", "2026-07-23", "gpt-5.6-sol", "text"),
  openAiRecord("gpt-5.1-chat-latest", "2026-07-23", "gpt-5.6-sol", "text"),
  openAiRecord("gpt-5.1-codex", "2026-07-23", "gpt-5.6-sol", "text"),
  openAiRecord("gpt-5.1-codex-max", "2026-07-23", "gpt-5.6-sol", "text"),
  openAiRecord("gpt-5.1-codex-mini", "2026-07-23", "gpt-5.6-terra", "text"),
  openAiRecord("gpt-5.2-codex", "2026-07-23", "gpt-5.6-sol", "text"),
  openAiRecord("o3-deep-research-2025-06-26", "2026-07-23", "gpt-5.6-sol", "deep-research"),
  openAiRecord("o3-deep-research", "2026-07-23", "gpt-5.6-sol", "deep-research"),
  openAiRecord("o4-mini-deep-research-2025-06-26", "2026-07-23", "gpt-5.6-sol", "deep-research"),
  openAiRecord("o4-mini-deep-research", "2026-07-23", "gpt-5.6-sol", "deep-research"),
  openAiRecord("gpt-audio-mini-2025-10-06", "2026-07-23", "gpt-audio-1.5", "audio"),
  openAiRecord("gpt-realtime-mini-2025-10-06", "2026-07-23", "gpt-realtime-2.1-mini", "realtime"),
  openAiRecord("gpt-5.2-chat-latest", "2026-08-10", "gpt-5.6-sol", "text"),
  openAiRecord("gpt-5.3-chat-latest", "2026-08-10", "gpt-5.6-sol", "text"),
  openAiRecord("gpt-3.5-turbo-0125", "2026-10-23", "gpt-5.6-terra", "text"),
  openAiRecord("gpt-4-0314", "2026-03-26", null, "text"),
  openAiRecord("gpt-4-0125-preview", "2026-03-26", null, "text"),
  openAiRecord("gpt-4-turbo-preview", "2026-03-26", null, "text"),
]);

const RECORDS_BY_KEY = new Map();

function lifecycleKey(provider, model) {
  return `${provider.trim().toLowerCase()}\0${model.trim()}`;
}

for (const record of MODEL_LIFECYCLE_RECORDS) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.shutdownAt)) {
    throw new Error(
      `Invalid model lifecycle shutdown date for ${record.provider}/${record.model}: ${record.shutdownAt}`,
    );
  }
  const key = lifecycleKey(record.provider, record.model);
  if (RECORDS_BY_KEY.has(key)) {
    throw new Error(`Duplicate model lifecycle record: ${record.provider}/${record.model}`);
  }
  if (record.replacement) Object.freeze(record.replacement);
  RECORDS_BY_KEY.set(key, Object.freeze(record));
}

function toTimestamp(asOf) {
  const value =
    asOf instanceof Date
      ? asOf.getTime()
      : typeof asOf === "number"
        ? asOf
        : Date.parse(asOf);
  if (!Number.isFinite(value)) {
    throw new TypeError(`Invalid model lifecycle date: ${String(asOf)}`);
  }
  return value;
}

function shutdownTimestamp(shutdownAt) {
  return Date.parse(`${shutdownAt}T00:00:00.000Z`);
}

/**
 * @param {string | null | undefined} provider
 * @param {string | null | undefined} model
 * @param {Date | number | string} [asOf=Date.now()]
 * @returns {ModelLifecycleDecision}
 */
export function getModelLifecycleDecision(provider, model, asOf = Date.now()) {
  const normalizedProvider =
    typeof provider === "string" ? provider.trim().toLowerCase() : "";
  const normalizedModel = typeof model === "string" ? model.trim() : "";
  const record = RECORDS_BY_KEY.get(lifecycleKey(normalizedProvider, normalizedModel));

  if (!record) {
    return {
      provider: normalizedProvider,
      model: normalizedModel,
      status: "untracked",
      action: "allow",
      shutdownAt: null,
      replacement: null,
      source: null,
    };
  }

  const status =
    toTimestamp(asOf) >= shutdownTimestamp(record.shutdownAt) ? "shutdown" : "deprecated";
  return {
    provider: record.provider,
    model: record.model,
    status,
    action: status === "shutdown" ? "reject" : "warn",
    shutdownAt: record.shutdownAt,
    replacement: record.replacement,
    source: record.source,
  };
}

/**
 * @param {ModelLifecycleDecision} decision
 * @returns {string | null}
 */
export function formatModelLifecycleMessage(decision) {
  if (decision.status === "untracked") return null;

  const modelRef = `${decision.provider}/${decision.model}`;
  const replacement = decision.replacement
    ? ` Use "${decision.replacement.provider}/${decision.replacement.model}" instead.`
    : "";
  if (decision.status === "shutdown") {
    return `Model "${modelRef}" was shut down on ${decision.shutdownAt} and cannot be routed automatically.${replacement}`;
  }
  return `Model "${modelRef}" is deprecated and is scheduled to shut down on ${decision.shutdownAt}.${replacement}`;
}

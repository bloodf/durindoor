/**
 * Antigravity account catalog contract.
 *
 * The Antigravity model list is account scoped. Cloud Code's available-models
 * RPC only describes the models a given Google account may use, and it only
 * answers that question for a project the account owns: the request has to
 * carry the account's Cloud Code project. A request without one is not bound to
 * the signed-in account, so its answer is not that account's catalog.
 *
 * Upstream provenance, router-for-me/CLIProxyAPI pinned at
 * 6960763455c4ac3d4828fb1736aa5de2183ccecf (and earlier 6faa8d20),
 * `sdk/auth/antigravity_models.go` / `sdk/cliproxy/antigravity_models.go`:
 * - `AntigravityModelBaseURLDaily` / `AntigravityModelsPath` — the endpoint.
 * - `FetchAntigravityAvailableModels` — the request body `{"project": "<id>"}`,
 *   bearer authorization, and the three probe statuses.
 * - `ParseAntigravityModelCapabilityHints` — the payload shape, where an
 *   absent `models` object is an unknown answer and `{}` is an empty catalog.
 * - `BuildPersistedAntigravityCapabilityHints` /
 *   `ParsePersistedAntigravityCapabilityHints` — per-connection hints under
 *   `antigravity_capability_hints`, bound to project id, sanitized endpoint and
 *   a credential-free route fingerprint (proxy URL + User-Agent).
 *
 * OmniRoute, cheaper-inference/OmniRoute pinned at
 * 5ffa68e83544 (release/v3.8.55 line) and earlier fbd3396,
 * `open-sse/services/usage/antigravity.ts`
 * (`fetchAntigravityAvailableModelsCached`), sends the same body shape and
 * caches the answer per access token and project.
 */

import { createHash } from "node:crypto";
import { isNumber, isRecord, isString } from "../../src/shared/utils/typeChecks.js";
import { ANTIGRAVITY_IDE_USER_AGENT } from "../providers/shared.js";
import { normalizeCloudCodeProjectId } from "./usage/shared.js";

/**
 * The per-account model catalog endpoint. Upstream names the host
 * `AntigravityModelBaseURLDaily` and the path `AntigravityModelsPath`.
 */
export const ANTIGRAVITY_CATALOG_URL =
  "https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels";

/** Connection PSD / auth-metadata key for persisted capability hints. */
export const ANTIGRAVITY_CAPABILITY_HINTS_META_KEY = "antigravity_capability_hints";

/** Upstream `registry.ModelsRefreshInterval` — three hours. */
export const ANTIGRAVITY_CAPABILITY_CACHE_TTL_MS = 3 * 60 * 60 * 1000;

const ANTIGRAVITY_MAX_CATALOG_MODELS = 1024;
const ANTIGRAVITY_MAX_MODEL_ID_BYTES = 256;
/** How a catalog probe ended. */
export const ANTIGRAVITY_CATALOG_OUTCOME = Object.freeze({
  SUCCESS: "success",
  AUTH_ERROR: "auth_error",
  FORBIDDEN: "forbidden",
  TRANSIENT: "transient",
});

/**
 * Classify an HTTP status from the catalog endpoint.
 *
 * 401 rejects the token; 403 rejects the project probe. Other non-2xx
 * answers are transient.
 *
 * @param {number} httpStatus
 * @returns {"success"|"auth_error"|"forbidden"|"transient"}
 */
export function classifyAntigravityCatalogStatus(httpStatus) {
  if (httpStatus === 401) return ANTIGRAVITY_CATALOG_OUTCOME.AUTH_ERROR;
  if (httpStatus === 403) return ANTIGRAVITY_CATALOG_OUTCOME.FORBIDDEN;
  if (!Number.isInteger(httpStatus) || httpStatus < 200 || httpStatus >= 300) {
    return ANTIGRAVITY_CATALOG_OUTCOME.TRANSIENT;
  }
  return ANTIGRAVITY_CATALOG_OUTCOME.SUCCESS;
}

/**
 * The connection's Cloud Code project, validated the same way the Antigravity
 * quota path validates it. A value in a shape Google does not use is treated
 * as "no project" rather than sent on as a placeholder.
 *
 * @param {object} [connection]
 * @returns {string|null}
 */
export function resolveAntigravityConnectionProject(connection) {
  return normalizeCloudCodeProjectId(connection?.projectId) ||
    normalizeCloudCodeProjectId(connection?.providerSpecificData?.projectId) ||
    null;
}

/**
 * The request body for the catalog probe. The project is omitted when the
 * connection has no valid one, so an unusable value never reaches the provider.
 *
 * @param {object} [connection]
 * @returns {{project?: string}}
 */
export function buildAntigravityCatalogBody(connection) {
  const project = resolveAntigravityConnectionProject(connection);
  return project ? { project } : {};
}

/**
 * Parse the catalog payload into the public model rows.
 *
 * Returns null when the payload is not a catalog: the probe could not classify
 * the answer, and the caller has to keep whatever catalog it already knows.
 * An empty `models` object is a catalog with no models, not an unknown answer.
 *
 * @param {unknown} data
 * @returns {object[]|null}
 */
export function parseAntigravityCatalogModels(data) {
  if (!isRecord(data) || !isRecord(data.models)) return null;
  return Object.entries(data.models)
    .filter(([id, info]) => !info?.isInternal && !id.includes("-disabled") && !id.startsWith("tab_"))
    .map(([id, info]) => ({
      id,
      name: info?.displayName || id,
      contextLength: info?.maxTokens,
      maxOutputTokens: info?.maxOutputTokens,
      supportsVision: !!info?.supportsImages,
      supportsReasoning: !!info?.supportsThinking
    }));
}

/**
 * Sanitize a persisted catalog endpoint: trim, drop trailing slashes, and strip
 * any URL userinfo so credentials never land in stored hints.
 *
 * @param {string} [endpoint]
 * @returns {string}
 */
export function sanitizeAntigravityPersistedEndpoint(endpoint) {
  const trimmed = String(endpoint || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    if (parsed.username || parsed.password) {
      parsed.username = "";
      parsed.password = "";
      return parsed.toString().replace(/\/+$/, "");
    }
  } catch {
    // Non-URL endpoints are stored trimmed only.
  }
  return trimmed;
}

/** Base URL persisted with capability hints (no path, no credentials). */
export function antigravityCatalogEndpoint() {
  return sanitizeAntigravityPersistedEndpoint(new URL(ANTIGRAVITY_CATALOG_URL).origin);
}

/**
 * Normalize a model id the way upstream `NormalizeAntigravityModelID` does.
 * @param {string} modelId
 * @returns {string}
 */
export function normalizeAntigravityModelId(modelId) {
  const trimmed = String(modelId || "").trim().toLowerCase();
  if (!trimmed || Buffer.byteLength(trimmed, "utf8") > ANTIGRAVITY_MAX_MODEL_ID_BYTES) return "";
  return trimmed;
}

/**
 * Credential-free SHA-256 of the effective proxy URL and client User-Agent.
 * Matches CLIProxyAPI `AntigravityCapabilityRouteFingerprint` (`%q/%q` form).
 *
 * @param {string} [proxyURL]
 * @param {string} [userAgent]
 * @returns {string}
 */
export function antigravityCapabilityRouteFingerprint(proxyURL, userAgent) {
  const ua = String(userAgent || "").trim();
  if (!ua) return "";
  const proxy = String(proxyURL || "").trim();
  const material = `${JSON.stringify(proxy)}/${JSON.stringify(ua)}`;
  return createHash("sha256").update(material).digest("hex");
}

/**
 * Proxy URL used for the catalog probe's route fingerprint.
 * @param {object|null} [proxyOptions]
 * @returns {string}
 */
export function antigravityCatalogProxyUrl(proxyOptions = null) {
  if (!proxyOptions || !isRecord(proxyOptions)) return "";
  return String(
    proxyOptions.connectionProxyUrl ||
    proxyOptions.url ||
    ""
  ).trim();
}

/**
 * Route fingerprint for a catalog probe/request.
 * @param {object|null} [proxyOptions]
 * @param {string} [userAgent]
 * @returns {string}
 */
export function antigravityCatalogRouteFingerprint(
  proxyOptions = null,
  userAgent = ANTIGRAVITY_IDE_USER_AGENT
) {
  return antigravityCapabilityRouteFingerprint(
    antigravityCatalogProxyUrl(proxyOptions),
    userAgent
  );
}

function parsePersistedModelSet(raw) {
  if (!Array.isArray(raw)) return null;
  if (raw.length > ANTIGRAVITY_MAX_CATALOG_MODELS) return null;
  const set = new Set();
  for (const item of raw) {
    if (!isString(item)) return null;
    const normalized = normalizeAntigravityModelId(item);
    if (normalized) set.add(normalized);
  }
  return set;
}

function parsePersistedTime(raw) {
  if (!isString(raw) || !raw.trim()) return null;
  const parsed = Date.parse(raw.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Decode a fetchAvailableModels payload into capability hints.
 * `modelIds === null` means unknown; an empty Set is an authoritative empty catalog.
 *
 * @param {unknown} data
 * @returns {{ modelIds: Set<string>|null, webSearchModelIds: Set<string> }|null}
 */
export function parseAntigravityModelCapabilityHints(data) {
  if (!isRecord(data)) return null;

  const webSearchModelIds = new Set();
  if (Object.hasOwn(data, "webSearchModelIds") && data.webSearchModelIds != null) {
    if (!Array.isArray(data.webSearchModelIds)) return null;
    if (data.webSearchModelIds.length > ANTIGRAVITY_MAX_CATALOG_MODELS) return null;
    for (const item of data.webSearchModelIds) {
      if (!isString(item)) return null;
      const normalized = normalizeAntigravityModelId(item);
      if (normalized) webSearchModelIds.add(normalized);
    }
  }

  let modelIds = null;
  if (Object.hasOwn(data, "models") && data.models != null) {
    if (!isRecord(data.models)) return null;
    const entries = Object.keys(data.models);
    if (entries.length > ANTIGRAVITY_MAX_CATALOG_MODELS) return null;
    modelIds = new Set();
    for (const id of entries) {
      const normalized = normalizeAntigravityModelId(id);
      if (normalized) modelIds.add(normalized);
    }
  }

  return { modelIds, webSearchModelIds };
}

/**
 * Serialize capability hints for connection PSD. Returns null when `modelIds`
 * is null so an unknown catalog is never stored as an authoritative empty set.
 *
 * @param {string} project
 * @param {string} endpoint
 * @param {{ modelIds: Set<string>|null, webSearchModelIds?: Set<string>, routeFingerprint?: string, updatedAt?: Date|number|string|null, expiresAt?: Date|number|string|null }} hints
 * @returns {Record<string, unknown>|null}
 */
export function buildPersistedAntigravityCapabilityHints(project, endpoint, hints) {
  if (!hints || hints.modelIds == null) return null;
  const modelIds = [...hints.modelIds]
    .map(normalizeAntigravityModelId)
    .filter(Boolean)
    .sort();
  const value = { model_ids: modelIds };
  const trimmedProject = String(project || "").trim();
  if (trimmedProject) value.project_id = trimmedProject;
  const sanitizedEndpoint = sanitizeAntigravityPersistedEndpoint(endpoint);
  if (sanitizedEndpoint) value.endpoint = sanitizedEndpoint;
  const routeFingerprint = String(hints.routeFingerprint || "").trim();
  if (routeFingerprint) value.route_fingerprint = routeFingerprint;
  const updatedAt = coerceTime(hints.updatedAt);
  if (updatedAt) value.updated_at = new Date(updatedAt).toISOString();
  const expiresAt = coerceTime(hints.expiresAt);
  if (expiresAt) value.expires_at = new Date(expiresAt).toISOString();
  const webSearch = [...(hints.webSearchModelIds || [])]
    .map(normalizeAntigravityModelId)
    .filter(Boolean)
    .sort();
  value.web_search_model_ids = webSearch;
  return value;
}

function coerceTime(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (isNumber(value) && Number.isFinite(value)) return value;
  return parsePersistedTime(value);
}

/**
 * Read persisted hints from connection PSD (or auth metadata shaped the same way).
 * Requires matching project and sanitized endpoint.
 *
 * @param {object|null|undefined} metadata
 * @param {string} expectedProject
 * @param {string} expectedEndpoint
 * @returns {{ modelIds: Set<string>, webSearchModelIds: Set<string>, routeFingerprint: string, updatedAt: number|null, expiresAt: number|null }|null}
 */
export function parsePersistedAntigravityCapabilityHints(metadata, expectedProject, expectedEndpoint) {
  if (!isRecord(metadata)) return null;
  const raw = metadata[ANTIGRAVITY_CAPABILITY_HINTS_META_KEY];
  if (!isRecord(raw)) return null;
  const persistedProject = isString(raw.project_id) ? raw.project_id : "";
  const persistedEndpoint = isString(raw.endpoint) ? raw.endpoint : "";
  if (persistedProject.trim() !== String(expectedProject || "").trim()) return null;
  if (
    sanitizeAntigravityPersistedEndpoint(persistedEndpoint) !==
    sanitizeAntigravityPersistedEndpoint(expectedEndpoint)
  ) {
    return null;
  }
  if (!Object.hasOwn(raw, "model_ids") || raw.model_ids == null) return null;
  const modelIds = parsePersistedModelSet(raw.model_ids);
  if (!modelIds) return null;
  let webSearchModelIds = new Set();
  if (Object.hasOwn(raw, "web_search_model_ids") && raw.web_search_model_ids != null) {
    const parsed = parsePersistedModelSet(raw.web_search_model_ids);
    if (!parsed) return null;
    webSearchModelIds = parsed;
  }
  return {
    modelIds,
    webSearchModelIds,
    routeFingerprint: isString(raw.route_fingerprint) ? raw.route_fingerprint.trim() : "",
    updatedAt: parsePersistedTime(raw.updated_at),
    expiresAt: parsePersistedTime(raw.expires_at)
  };
}

/**
 * Build the PSD patch that stores hints for one connection.
 * @param {object} connection
 * @param {unknown} catalogPayload
 * @param {{ proxyOptions?: object|null, userAgent?: string, now?: number }} [options]
 * @returns {Record<string, unknown>|null}
 */
export function buildAntigravityCapabilityHintsPsdPatch(
  connection,
  catalogPayload,
  { proxyOptions = null, userAgent = ANTIGRAVITY_IDE_USER_AGENT, now = Date.now() } = {}
) {
  const parsed = parseAntigravityModelCapabilityHints(catalogPayload);
  if (!parsed || parsed.modelIds == null) return null;
  const routeFingerprint = antigravityCatalogRouteFingerprint(proxyOptions, userAgent);
  const value = buildPersistedAntigravityCapabilityHints(
    resolveAntigravityConnectionProject(connection) || "",
    antigravityCatalogEndpoint(),
    {
      modelIds: parsed.modelIds,
      webSearchModelIds: parsed.webSearchModelIds,
      routeFingerprint,
      updatedAt: now,
      expiresAt: now + ANTIGRAVITY_CAPABILITY_CACHE_TTL_MS
    }
  );
  if (!value) return null;
  return { [ANTIGRAVITY_CAPABILITY_HINTS_META_KEY]: value };
}

/**
 * Reuse persisted hints when project, endpoint and route fingerprint still match.
 * @param {object} connection
 * @param {{ proxyOptions?: object|null, userAgent?: string, now?: number }} [options]
 * @returns {{ models: object[], source: string, routeFingerprint: string }|null}
 */
export function reuseAntigravityCapabilityHints(
  connection,
  { proxyOptions = null, userAgent = ANTIGRAVITY_IDE_USER_AGENT, now = Date.now() } = {}
) {
  const project = resolveAntigravityConnectionProject(connection) || "";
  const endpoint = antigravityCatalogEndpoint();
  const hints = parsePersistedAntigravityCapabilityHints(
    connection?.providerSpecificData,
    project,
    endpoint
  );
  if (!hints) return null;
  const expectedFingerprint = antigravityCatalogRouteFingerprint(proxyOptions, userAgent);
  if (!expectedFingerprint || hints.routeFingerprint !== expectedFingerprint) return null;
  if (hints.expiresAt != null && hints.expiresAt <= now) return null;
  if (
    hints.updatedAt != null &&
    hints.updatedAt + ANTIGRAVITY_CAPABILITY_CACHE_TTL_MS <= now
  ) {
    return null;
  }
  return {
    models: [...hints.modelIds].sort().map((id) => ({ id, name: id })),
    source: "persisted_capability_hints",
    routeFingerprint: hints.routeFingerprint
  };
}

// A forbidden probe is scoped to the connection and project, not its token.
// CLIProxyAPI f5c5681a sdk/cliproxy/antigravity_models.go uses a five-minute
// minimum with exponential equal-jitter backoff, capped at sixty minutes.
const forbiddenProbes = new Map();
const FORBIDDEN_HISTORY_TTL = 24 * 60 * 60 * 1000;
function forbiddenKey(connection) {
  return JSON.stringify([connection.id, resolveAntigravityConnectionProject(connection)]);
}
export function antigravityForbiddenBackoff(connection, now = Date.now()) {
  const key = forbiddenKey(connection);
  const state = forbiddenProbes.get(key);
  if (state && now - state.lastFailure > FORBIDDEN_HISTORY_TTL) forbiddenProbes.delete(key);
  return state && now < state.nextRetry ? state.result : null;
}
export function recordAntigravityForbidden(connection, result, now = Date.now()) {
  for (const [key, state] of forbiddenProbes) {
    if (now - state.lastFailure > FORBIDDEN_HISTORY_TTL) forbiddenProbes.delete(key);
  }
  const key = forbiddenKey(connection);
  const failures = Math.min((forbiddenProbes.get(key)?.failures || 0) + 1, 5);
  const window = Math.min(10 * 60 * 1000 * 2 ** (failures - 1), 60 * 60 * 1000);
  forbiddenProbes.set(key, { failures, lastFailure: now, nextRetry: now + window / 2 + Math.random() * window / 2, result });
}

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
 * 6faa8d20b2673404cff70a2f2d9537ae0d0e684d,
 * `sdk/auth/antigravity_models.go`:
 * - `AntigravityModelBaseURLDaily` / `AntigravityModelsPath` — the endpoint.
 * - `FetchAntigravityAvailableModels` — the request body `{"project": "<id>"}`,
 *   bearer authorization, and the three probe statuses.
 * - `ParseAntigravityModelCapabilityHints` — the payload shape, where an
 *   absent `models` object is an unknown answer and `{}` is an empty catalog.
 *
 * OmniRoute, cheaper-inference/OmniRoute pinned at
 * fbd339668384803bc3a9d42370fc413a55e013d5,
 * `open-sse/services/usage/antigravity.ts`
 * (`fetchAntigravityAvailableModelsCached`), sends the same body shape and
 * caches the answer per access token and project.
 */

import { isRecord } from "../../src/shared/utils/typeChecks.js";
import { normalizeCloudCodeProjectId } from "./usage/shared.js";

/**
 * The per-account model catalog endpoint. Upstream names the host
 * `AntigravityModelBaseURLDaily` and the path `AntigravityModelsPath`.
 */
export const ANTIGRAVITY_CATALOG_URL =
  "https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels";

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

// Scope an `auto/<family>` candidate pool to the caller's API-key connection
// allowlist (port of OmniRoute c40aaac6 and the scoped branch of
// buildAutoCandidates it fixes).
//
// An API key with relation rows may only route through those provider
// connections. Credential selection already enforces that at dispatch, and a
// scoped key never gets a public no-auth credential. Without this filter the
// auto pool still listed models the key can never reach, so ranking and
// fallback spent attempts on them.
//
// Read errors:
// - Allowlist read fails: the scope is unknown, so no candidate is kept
//   (fail closed). The combo path then answers with its controlled 503.
// - Active-connection read fails while the scope is known: the pool is kept
//   and a sanitized warning is logged, as upstream does. Dispatch reads the
//   scope again and fails closed if a model has no permitted connection.
import { getApiKeyProviderConnectionIds, getProviderConnections } from "@/lib/localDb";
import { sanitizeErrorMessage } from "open-sse/utils/error.js";
import { isAutoComboId } from "open-sse/services/autoComboResolver.js";
import { getModelInfo } from "./model.js";
import * as log from "../utils/logger.js";

function describeError(error) {
  return sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
}

/**
 * @param {string} modelStr requested model; only `auto/<family>` ids are scoped
 * @param {string[]|null} models auto pool from getComboModels
 * @param {string|null|undefined} apiKeyId verified caller key id
 * @param {object} [deps] test seams
 * @returns {Promise<string[]|null>} scoped pool; input unchanged when unscoped
 */
export async function scopeAutoComboModels(modelStr, models, apiKeyId, deps = {}) {
  if (!Array.isArray(models) || !isAutoComboId(modelStr) || !apiKeyId) return models;
  const readScope = deps.getApiKeyProviderConnectionIds || getApiKeyProviderConnectionIds;
  const readConnections = deps.getProviderConnections || getProviderConnections;
  const resolveModel = deps.getModelInfo || getModelInfo;
  const logger = deps.log || log;

  let scopeIds;
  try {
    scopeIds = await readScope(apiKeyId);
  } catch (error) {
    logger.warn("COMBO_AUTO", "Scoped auto candidates: API key connection scope read failed; no candidates kept", {
      error: describeError(error)
    });
    return [];
  }
  // Zero relation rows means the key is unrestricted.
  if (!Array.isArray(scopeIds) || scopeIds.length === 0) return models;
  const scope = new Set(scopeIds);

  let connections;
  try {
    connections = await readConnections({ isActive: true });
  } catch (error) {
    logger.warn("COMBO_AUTO", "Scoped auto candidates: active connection read failed; keeping targets", {
      scopeSize: scope.size,
      error: describeError(error)
    });
    return models;
  }
  const permittedProviders = new Set(
    (Array.isArray(connections) ? connections : [])
      .filter((connection) => connection?.isActive !== false && scope.has(connection.id))
      .map((connection) => connection.provider)
  );

  const kept = [];
  for (const modelId of models) {
    let provider = null;
    try {
      provider = (await resolveModel(modelId))?.provider || null;
    } catch {
      provider = null;
    }
    if (provider && permittedProviders.has(provider)) kept.push(modelId);
  }
  return kept;
}

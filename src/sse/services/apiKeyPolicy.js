import { getApiKeyByKey, getApiKeyUsageTotals, getApiKeyById, saveRequestUsage } from "@/lib/localDb";
import { extractApiKey, hasValidCliToken } from "./auth.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "../utils/logger.js";
import { validateApiKeyPolicy } from "@/lib/db/helpers/apiKeyPolicy.js";
import { canonicalizePolicyModelIdentity } from "./apiKeyPolicyIdentity.js";
import { isObject, isString } from "../../shared/utils/typeChecks.js";

/**
 * Check if a model is allowed by the API key policy.
 * Empty allowedModels = all models allowed.
 * Exact match against the requested model string.
 *
 * @param {{ allowedModels?: string[] } | null} policy
 * @param {string} modelStr
 * @returns {boolean}
 */
export function isModelAllowed(policy, modelStr) {
  if (!policy || !policy.allowedModels || policy.allowedModels.length === 0) {
    return true;
  }
  const candidate = canonicalizePolicyModelIdentity(modelStr);
  return policy.allowedModels.some((allowed) => {
    const canonicalAllowed = canonicalizePolicyModelIdentity(allowed);
    if (canonicalAllowed === candidate) return true;
    // Compatibility for policies created before web operations gained
    // least-privilege identities: a bare provider grants both web operations.
    if (candidate.endsWith("/search") || candidate.endsWith("/fetch")) {
      return canonicalAllowed === candidate.slice(0, candidate.lastIndexOf("/"));
    }
    return false;
  });
}

/**
 * Record a normalized non-chat event through the shared atomic usage ledger.
 * Callers must provide a stable usageEventId, provider, model, endpoint,
 * connectionId (null only for credential-free execution), modality, token
 * object, nativeUnits object, USD cost and costStatus/costSource provenance.
 * known means authoritative, estimated means a caller estimate, and unknown
 * requires null cost. Never pass guessed free cost or scalar token totals.
 * Incomplete legacy events and storage failures throw; there is no totals-only
 * fallback. A missing API key still records local usage without key totals.
 * Every failure carries code USAGE_ACCOUNTING_FAILED and the original cause:
 * upstream work has completed, so callers must propagate it without dispatching again.
 * usage.billingEpoch must be the admission auth.billingEpoch (or the durable
 * job's creation epoch), never a completion-time lookup. Preserve explicit null:
 * legacy null/omitted epochs are valid only before cutover; the ledger checks
 * exact equality under its import/write lock after cutover. This wrapper never
 * fills in a missing epoch or retries upstream work after a fence rejection.
 *
 * @param {string|null} apiKey Resolved caller credential, never a provider key.
 * @param {object} usage Normalized event; see saveRequestUsage.
 */
export async function recordApiKeyUsage(apiKey, usage) {
  try {
    for (const field of ["usageEventId", "provider", "model", "endpoint", "modality", "costSource"]) {
      if (!isString(usage?.[field]) || !usage[field].trim()) throw new TypeError(`Usage event requires ${field}`);
    }
    if (usage.connectionId !== null && (!isString(usage.connectionId) || !usage.connectionId.trim())) {
      throw new TypeError("Usage event requires connectionId or explicit null");
    }
    for (const field of ["tokens", "nativeUnits"]) {
      if (usage[field] === null || !isObject(usage[field]) || Array.isArray(usage[field])) throw new TypeError(`Usage event requires ${field} object`);
    }
    if (usage.cost === undefined || !["known", "estimated", "unknown"].includes(usage.costStatus)) {
      throw new TypeError("Usage event requires cost and costStatus");
    }
    const committed = await saveRequestUsage({ ...usage, apiKey, status: "ok", strict: true });
    if (committed === false) throw new Error("Usage accounting was not committed");
  } catch (cause) {
    const error = new Error(cause?.message || String(cause), { cause });
    error.code = "USAGE_ACCOUNTING_FAILED";
    throw error;
  }
}

/**
 * Record non-chat usage only after a successful response. Validation errors,
 * policy denials, and upstream failures must not consume a caller's lifetime
 * allowance.
 */
export async function recordApiKeyUsageForResponse(apiKey, response, usage) {
  if (response && response.status >= 200 && response.status < 300) {
    await recordApiKeyUsage(apiKey, usage);
  }
  return response;
}

/**
 * Enforce API key policy on a request: model allowlist, model access rules,
 * windowed limits (RPM, daily/monthly tokens, requests, budget) and lifetime
 * token/cost limits.
 *
 * Call this AFTER the shared credential resolver and pass its resolved key so
 * stale lower-precedence credentials cannot bypass the authenticated key's
 * policy. If no key is provided, legacy callers use the first credential.
 * If the key has no policy or an empty allowedModels list, returns null.
 *
 * @param {Request} request
 * @param {string} modelStr
 * @param {string | null} [apiKey]
 * @param {{ limits?: boolean }} [options] `limits: false` skips the windowed
 *   limits (used by count_tokens, which never reaches a provider).
 * @returns {Promise<Response | null>}
 */
export async function enforceApiKeyModelPolicy(request, modelStr, apiKey, { limits = true } = {}) {
  // Skip policy enforcement for internal dashboard/CLI requests only when the CLI
  // token is genuinely valid. An arbitrary non-empty header should not bypass policy.
  const hasCli = await hasValidCliToken(request);
  if (hasCli) return null;

  if (apiKey === undefined) apiKey = extractApiKey(request);
  if (!apiKey) return null;

  const keyRecord = await getApiKeyByKey(apiKey);
  if (!keyRecord || !keyRecord.isActive) return null;

  const policyResult = validateApiKeyPolicy(keyRecord.policy);
  if (!policyResult.ok) {
    log.warn("AUTH", `Invalid policy for API key "${keyRecord.name}": ${policyResult.error}`);
    return errorResponse(
      HTTP_STATUS.FORBIDDEN,
      "API key policy is invalid; contact the administrator"
    );
  }
  const policy = policyResult.value || {};

  // Check model allowlist
  if (!isModelAllowed(policy, modelStr)) {
    log.warn("AUTH", `Model "${modelStr}" not allowed for API key "${keyRecord.name}"`);
    return errorResponse(
      HTTP_STATUS.FORBIDDEN,
      `Model "${modelStr}" is not allowed for this API key`
    );
  }

  // Loaded on demand: both pull in the provider registry and the usage
  // repository, which most callers of this module never need.
  if (policy.modelAccess && policy.modelAccess.mode !== "all") {
    const { getModelAccessCandidateBuilder, isModelAccessAllowed } = await import("./modelAccess.js");
    const candidatesFor = await getModelAccessCandidateBuilder();
    if (!isModelAccessAllowed(policy.modelAccess, candidatesFor(modelStr))) {
      log.warn("AUTH", `Model "${modelStr}" blocked by model access rules for API key "${keyRecord.name}"`);
      return errorResponse(
        HTTP_STATUS.FORBIDDEN,
        `Model "${modelStr}" is not allowed for this API key`
      );
    }
  }

  if (limits && keyRecord.key) {
    const { enforceApiKeyLimits } = await import("@/lib/apiKeyLimits.js");
    const limitError = await enforceApiKeyLimits(request, { ...keyRecord, policy });
    if (limitError) {
      log.warn("AUTH", `Windowed limit reached for API key "${keyRecord.name}"`);
      return limitError;
    }
  }

  // Check token/cost limits
  const maxTokens = policy.maxTokens != null ? Number(policy.maxTokens) : null;
  const maxCostUsd = policy.maxCostUsd != null ? Number(policy.maxCostUsd) : null;

  if (maxTokens != null || maxCostUsd != null) {
    const usage = await getApiKeyUsageTotals(keyRecord.id);

    if (maxTokens != null && usage.totalTokens >= maxTokens) {
      log.warn("AUTH", `Token limit reached for API key "${keyRecord.name}" (${usage.totalTokens}/${maxTokens})`);
      return errorResponse(
        HTTP_STATUS.RATE_LIMITED,
        `API key token limit reached (${usage.totalTokens}/${maxTokens} tokens)`
      );
    }

    if (maxCostUsd != null && usage.totalCost >= maxCostUsd) {
      log.warn("AUTH", `Cost limit reached for API key "${keyRecord.name}" ($${usage.totalCost.toFixed(4)}/$${maxCostUsd})`);
      return errorResponse(
        HTTP_STATUS.RATE_LIMITED,
        `API key cost limit reached ($${usage.totalCost.toFixed(4)}/$${maxCostUsd})`
      );
    }
  }

  return null;
}

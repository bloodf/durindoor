import { getApiKeyByKey, getApiKeyUsageTotals, getApiKeyById, incrementApiKeyUsageSync } from "@/lib/localDb";
import { extractApiKey } from "./auth.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "../utils/logger.js";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { validateApiKeyPolicy } from "@/lib/db/helpers/apiKeyPolicy.js";

const CLI_AUTH_SALT = "9r-cli-auth";

async function hasValidCliToken(request) {
  const token = request?.headers?.get("x-9r-cli-token");
  if (!token) return false;
  return token === await getConsistentMachineId(CLI_AUTH_SALT);
}

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
  return policy.allowedModels.includes(modelStr);
}

/**
 * Record usage for an API key before enforcing non-chat limits.
 * Runs in its own adapter write so non-chat handlers can count usage even when
 * no saveRequestUsage transaction is active.
 *
 * @param {string} apiKey
 * @param {{ tokens?: number, cost?: number }} usage
 */
export async function recordApiKeyUsage(apiKey, usage) {
  if (!apiKey || !usage) return;
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  const row = db.get(`SELECT id FROM apiKeys WHERE key = ?`, [apiKey]);
  if (!row) return;
  incrementApiKeyUsageSync(db, row.id, usage);
}

/**
 * Record non-chat usage only after a successful response. Validation errors,
 * policy denials, and upstream failures must not consume a caller's lifetime
 * allowance.
 */
export async function recordApiKeyUsageForResponse(apiKey, response, usage) {
  if (apiKey && response && response.status >= 200 && response.status < 300) {
    await recordApiKeyUsage(apiKey, usage);
  }
  return response;
}

/**
 * Enforce API key policy on a request: model allowlist + token/cost limits.
 *
 * Call this AFTER the shared evaluateApiKeyAuth guard.
 * If no API key is provided, returns null (allow — requireApiKey handles that case).
 * If the key has no policy or an empty allowedModels list, returns null (allow all).
 * If the model is not in the allowlist, returns a 403 error Response.
 * If token or cost limit is exceeded, returns a 429 error Response.
 *
 * @param {Request} request
 * @param {string} modelStr - The model string from the request body
 * @returns {Promise<Response | null>} null if allowed, error Response if rejected
 */
export async function enforceApiKeyModelPolicy(request, modelStr) {
  // Skip policy enforcement for internal dashboard/CLI requests only when the CLI
  // token is genuinely valid. An arbitrary non-empty header should not bypass policy.
  const hasCli = await hasValidCliToken(request);
  if (hasCli) return null;

  const apiKey = extractApiKey(request);
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

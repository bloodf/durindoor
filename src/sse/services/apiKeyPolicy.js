import { getApiKeyByKey, getApiKeyUsageTotals } from "@/lib/localDb";
import { extractApiKey } from "./auth.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "../utils/logger.js";
import { getConsistentMachineId } from "@/shared/utils/machineId";

const CLI_AUTH_SALT = "9r-cli-auth";
let cachedCliToken = null;

async function getCliToken() {
  if (!cachedCliToken) cachedCliToken = await getConsistentMachineId(CLI_AUTH_SALT);
  return cachedCliToken;
}

async function hasValidCliToken(request) {
  const token = request?.headers?.get("x-9r-cli-token");
  if (!token) return false;
  return token === await getCliToken();
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
 * Enforce API key policy on a request: model allowlist + token/cost limits.
 *
 * Call this AFTER the existing requireApiKey/isValidApiKey check.
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

  const policy = keyRecord.policy || {};

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

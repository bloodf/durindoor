import { createHash } from "node:crypto";
import { getGitHubUsage } from "./usage/github.js";
import { GITHUB_CREDIT_USAGE_CACHE_TTL_MS, HTTP_STATUS } from "../config/runtimeConfig.js";
import { isNumber } from "../../src/shared/utils/typeChecks.js";

/**
 * Local spend cutoff for GitHub Copilot AI Credits.
 *
 * GitHub bills premium interactions as credits and does not stop at a
 * user-defined ceiling, so a runaway client can spend real money. A connection
 * may carry `providerSpecificData.aiCreditLimit`; when GitHub-reported usage
 * reaches it, requests on that connection are refused locally.
 *
 * This is a cutoff, NOT a guaranteed spending ceiling. Usage is cached briefly,
 * GitHub's own reporting lags, and in-flight requests are not counted, so real
 * spend can exceed the configured limit. The UI states this.
 *
 * Fails CLOSED: if usage cannot be fetched or parsed, the request is blocked.
 * A limit exists to protect money, so an unverifiable limit must not silently
 * behave like no limit at all.
 */

/** @type {Map<string, { expiresAt: number, promise: Promise<{ used?: number, failed?: boolean }> }>} */
const usageCache = new Map();

/**
 * Cache usage per credential+proxy pair for a short TTL so a burst of requests
 * costs one upstream call. The entry is inserted before the fetch resolves, so
 * concurrent callers share one in-flight promise rather than stampeding.
 */
function getCachedCreditUsage(credentials, proxyOptions) {
  const now = Date.now();
  for (const [key, entry] of usageCache) {
    if (entry.expiresAt <= now) usageCache.delete(key);
  }

  // Hashed so a raw access token is never used as a map key.
  const key = createHash("sha256").
    update(JSON.stringify([credentials.accessToken, proxyOptions])).
    digest("hex");
  const cached = usageCache.get(key);
  if (cached) return cached.promise;

  // Infinity until settled: an in-flight entry must not be evicted mid-fetch.
  const entry = { expiresAt: Infinity, promise: null };
  usageCache.set(key, entry);
  entry.promise = (async () => {
    try {
      const usage = await getGitHubUsage(
        credentials.accessToken,
        credentials.providerSpecificData,
        proxyOptions
      );
      return { used: usage?.quotas?.premium_interactions?.creditsUsed };
    } catch {
      return { failed: true };
    } finally {
      entry.expiresAt = Date.now() + GITHUB_CREDIT_USAGE_CACHE_TTL_MS;
    }
  })();
  return entry.promise;
}

/**
 * A limit is valid when it is null (disabled) or a finite non-negative number.
 * Shared with the connection PUT route so the API and the enforcement point
 * cannot drift apart on what counts as a usable value.
 * @param {unknown} limit
 * @returns {boolean}
 */
export function isValidGitHubCreditLimit(limit) {
  return limit === null || isNumber(limit) && Number.isFinite(limit) && limit >= 0;
}

/**
 * Decide whether a GitHub request must be refused by the local credit cutoff.
 * @param {object} credentials - Resolved connection credentials
 * @param {object|null} proxyOptions - Proxy options for the usage fetch
 * @returns {Promise<{ status: number, message: string }|null>} Refusal, or null to proceed
 */
export async function checkGitHubCreditLimit(credentials, proxyOptions = null) {
  const limit = credentials?.providerSpecificData?.aiCreditLimit;
  // No limit configured is the default for every existing connection.
  if (limit === undefined || limit === null) return null;

  if (!isValidGitHubCreditLimit(limit)) {
    return {
      status: HTTP_STATUS.SERVICE_UNAVAILABLE,
      message: "Invalid Copilot AI Credits limit. Update the connection settings before retrying.",
    };
  }

  // An explicit zero blocks without an upstream round-trip.
  if (limit === 0) {
    return {
      status: HTTP_STATUS.RATE_LIMITED,
      message: "Copilot AI Credits limit is zero. Requests are blocked by the local credit limit.",
    };
  }

  try {
    const { used, failed } = await getCachedCreditUsage(credentials, proxyOptions);
    if (failed || !isNumber(used) || !Number.isFinite(used) || used < 0) {
      return {
        status: HTTP_STATUS.SERVICE_UNAVAILABLE,
        message: "Cannot verify Copilot AI Credits usage. Request blocked to protect the configured credit limit.",
      };
    }
    if (used >= limit) {
      return {
        status: HTTP_STATUS.RATE_LIMITED,
        message: `Copilot AI Credits limit reached (${used} / ${limit}). Wait for GitHub usage to reset or change the connection limit.`,
      };
    }
    return null;
  } catch {
    return {
      status: HTTP_STATUS.SERVICE_UNAVAILABLE,
      message: "Cannot verify Copilot AI Credits usage. Request blocked to protect the configured credit limit.",
    };
  }
}

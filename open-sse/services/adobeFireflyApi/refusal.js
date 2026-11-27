// Adobe Firefly Services API: a refused submit, read from its status and two
// documented headers only. Shared by the image adapter (through the image
// core's describeSubmitError hook) and the video job.
//
// Contract: AdobeDocs/ffs-firefly-api at 1027f559cdb1509a61b34e2f2da9618ec431f2cb,
// static/firefly-api.json (blob 9004da2c5d57850bb72068e6e06b93e04b1bad9e). Both
// POST /v3/images/generate-async (generateImagesV3Async) and
// POST /v3/videos/generate (generateVideoV3) document:
// - 403 `x-access-error`, enum quota_exhausted, user_non_entitled,
//   user_profile_denied, invalid_ims_scope ("the reason access is not
//   authorized");
// - 429 `retry-after` ("the date after which the client should retry") and
//   `x-access-rate-limit-level`: `org` (applied to the organization) or
//   `account` (applied to the organization's tech account).
//
// Upstream body text is never read into a message. Only an exact documented
// header value is repeated; anything else is dropped. A `quota_exhausted` 403
// carries no reset, so it is reported as resetless quota exhaustion on the
// selected connection. A 429 sets a reset only from a bounded Retry-After,
// through the shared parser; no membership or daily window is assumed, and the
// level never reaches another connection: the gateway cannot tell which
// connections share an organization.
import { parseRateLimitEvidence } from "../../utils/error.js";
import { isFunction, isString } from "../../../src/shared/utils/typeChecks.js";

export const ADOBE_FIREFLY_ACCESS_ERRORS = Object.freeze(["quota_exhausted", "user_non_entitled", "user_profile_denied", "invalid_ims_scope"]);
export const ADOBE_FIREFLY_RATE_LIMIT_LEVELS = Object.freeze({ org: "organization", account: "technical account" });

const ACCESS_ERRORS = new Set(ADOBE_FIREFLY_ACCESS_ERRORS);

function header(response, name) {
  const value = isFunction(response?.headers?.get) ? response.headers.get(name) : null;
  return isString(value) ? value : null;
}

/** The documented `x-access-error` value, exactly, or null. */
export function adobeFireflyAccessError(response) {
  const value = header(response, "x-access-error");
  return value !== null && ACCESS_ERRORS.has(value) ? value : null;
}

/** `org` or `account` from `x-access-rate-limit-level`, exactly, or null. */
export function adobeFireflyRateLimitLevel(response) {
  const value = header(response, "x-access-rate-limit-level");
  return value !== null && Object.hasOwn(ADOBE_FIREFLY_RATE_LIMIT_LEVELS, value) ? value : null;
}

// A bounded Retry-After reset, read by the shared parser from that one header
// only, so no other header or body text can set or extend it. Account cooldown
// is wall-clock time, never an injected poll clock.
function retryAfterEvidence(response) {
  const retryAfter = header(response, "retry-after");
  if (retryAfter === null) return null;
  const evidence = parseRateLimitEvidence({ status: 429, headers: new Headers({ "retry-after": retryAfter }), now: Date.now() });
  return evidence?.source === "retry_after" && Number.isFinite(evidence.resetAtMs) ? evidence : null;
}

/**
 * A refused (non-2xx, non-redirect) submit as the gateway reports it.
 *
 * @param {Response} response - the submit answer; its body is not read
 * @param {"image"|"video"} kind
 * @returns {{ status: number, message: string, rateLimitEvidence: object|null,
 *   quotaExhausted: boolean, accessError: string|null, rateLimitLevel: string|null }}
 */
export function describeAdobeFireflySubmitRefusal(response, kind) {
  const what = kind === "video" ? "video" : "image";
  const status = Number(response?.status);
  const result = (resultStatus, message, extra = {}) => ({
    status: resultStatus, message, rateLimitEvidence: null, quotaExhausted: false, accessError: null, rateLimitLevel: null, ...extra,
  });
  if (status === 401) return result(401, `Adobe Firefly Services refused the access token for ${what} generation`);
  if (status === 403) {
    const accessError = adobeFireflyAccessError(response);
    const reason = accessError ? ` (${accessError})` : "";
    return result(403, `Adobe Firefly Services refused ${what} generation for this credential${reason}`, {
      accessError,
      quotaExhausted: accessError === "quota_exhausted",
    });
  }
  if (status === 429) {
    const rateLimitLevel = adobeFireflyRateLimitLevel(response);
    const level = rateLimitLevel ? ` at the ${ADOBE_FIREFLY_RATE_LIMIT_LEVELS[rateLimitLevel]} level` : "";
    return result(429, `Adobe Firefly Services rate limited the ${what} submit${level}`, {
      rateLimitLevel,
      rateLimitEvidence: retryAfterEvidence(response),
    });
  }
  if (status === 400 || status === 415 || status === 422) {
    return result(status === 415 ? 415 : 400, `Adobe Firefly Services rejected the ${what} request (${status})`);
  }
  if (status === 408) return result(504, `Adobe Firefly Services timed out reading the ${what} request`);
  return result(502, `Adobe Firefly Services ${what} submit returned ${Number.isInteger(status) ? status : "an unknown status"}`);
}

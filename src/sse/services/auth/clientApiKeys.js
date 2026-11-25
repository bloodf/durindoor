import { getApiKeyById, getApiKeyByKey, validateApiKey } from "@/lib/localDb";
import { isApiKeyExpired } from "@/shared/utils/apiKeyExpiry";
import { getBillingEpoch } from "@/lib/db/repos/usageRepo.js";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { timingSafeCompare } from "@/shared/utils/timingSafeCompare";
import { captureRequestBillingEpoch } from "../../utils/requestCorrelation.js";
import { getBatchRequestKeyId, rememberAdmittedRequestKey } from "../../services/batchKeyIdentity.js";

const CLI_AUTH_SALT = "9r-cli-auth";

export async function hasValidCliToken(request) {
  const supplied = request?.headers?.get?.("x-9r-cli-token");
  if (!supplied) return false;
  const expected = await getConsistentMachineId(CLI_AUTH_SALT);
  return timingSafeCompare(String(supplied), String(expected));
}

/**
 * Extract the first API key credential presented by a request.
 *
 * @param {Request} request
 * @returns {string | null}
 */
export function extractApiKey(request) {
  return extractApiKeyCandidates(request)[0] || null;
}

/**
 * Extract every distinct API key credential presented by one request, in
 * precedence order. Some Anthropic clients send a stale Bearer token beside a
 * valid `x-api-key`, so authentication must check both without trusting any
 * credential from another request.
 *
 * @param {Request} request
 * @returns {string[]}
 */
export function extractApiKeyCandidates(request) {
  if (!request?.headers?.get) return [];
  const candidates = [];
  const add = (value) => {
    if (value && !candidates.includes(value)) candidates.push(value);
  };
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) add(authHeader.slice(7));
  add(request.headers.get("x-api-key"));
  add(request.headers.get("x-goog-api-key"));
  add(new URL(request.url).searchParams.get("key"));
  return candidates;
}

/**
 * Resolve all credentials presented by one request and return the credential
 * that authenticated. Unknown placeholder keys remain allowed only in local
 * mode, after every candidate has been checked for a valid stored identity.
 * auth.billingEpoch is captured before credential reads and remains bound to
 * this Request across retries. Pass it unchanged into every usage event and
 * durable job; completion must never look up the current billing generation.
 *
 * @param {Request} request
 * @param {{ required?: boolean, now?: number }} options
 * @returns {Promise<{apiKey: string | null, auth: { apiKeyId?: string, ok: boolean, billingEpoch: string | null }}>}
 */
export async function resolveClientApiKey(request, { required = false, now = Date.now() } = {}) {
  const billingEpoch = await captureRequestBillingEpoch(request);
  const batchKeyId = getBatchRequestKeyId(request);
  if (batchKeyId) {
    const record = await getApiKeyById(batchKeyId);
    const valid = record?.isActive === true && !isApiKeyExpired(record.expiresAt, now);
    return { apiKey: valid ? record.key : null, auth: { ok: valid, reason: valid ? null : "invalid", stored: true, apiKeyId: valid ? batchKeyId : undefined, billingEpoch } };
  }
  const candidates = extractApiKeyCandidates(request);
  if (await hasValidCliToken(request)) {
    return { apiKey: candidates[0] || null, auth: { ok: true, reason: null, stored: false, operator: true, billingEpoch } };
  }
  for (const apiKey of candidates) {
    const auth = await evaluateApiKeyCredential(apiKey, { required: true, now });
    if (auth.ok) {
      if (auth.apiKeyId) rememberAdmittedRequestKey(request, auth.apiKeyId);
      return { apiKey, auth: { ...auth, billingEpoch } };
    }
  }
  const apiKey = candidates[0] || null;
  return { apiKey, auth: { ...await evaluateApiKeyCredential(apiKey, { required, now }), billingEpoch } };
}

/**
 * Validate API key (optional - for local use can skip)
 */
export async function isValidApiKey(apiKey) {
  if (!apiKey) return false;
  return await validateApiKey(apiKey);
}

/**
 * Evaluate a caller credential before any model/provider work.
 *
 * Local mode still permits an unknown placeholder credential for compatibility,
 * but once a credential matches a stored row it must be active and unexpired.
 * This prevents an expired or malformed stored key from becoming a policy/usage
 * identity when global API-key enforcement is disabled.
 */
async function evaluateApiKeyCredential(apiKey, { required, now }) {
  if (!apiKey) {
    return { ok: !required, reason: required ? "missing" : null, stored: false };
  }
  const record = await getApiKeyByKey(apiKey);
  if (!record) {
    return { ok: !required, reason: required ? "invalid" : null, stored: false };
  }

  const valid = record.isActive === true && !isApiKeyExpired(record.expiresAt, now);
  return { ok: valid, reason: valid ? null : "invalid", stored: true, apiKeyId: valid ? record.id : undefined };
}

export async function evaluateApiKeyAuth(apiKey, { required = false, now = Date.now(), request = null } = {}) {
  if (request) return (await resolveClientApiKey(request, { required, now })).auth;
  // Without a Request, this call is admission; callers must retain its result.
  const billingEpoch = await getBillingEpoch();
  return { ...await evaluateApiKeyCredential(apiKey, { required, now }), billingEpoch };
}

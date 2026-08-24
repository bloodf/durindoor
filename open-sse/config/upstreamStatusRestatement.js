import { HTTP_STATUS } from "./runtimeConfig.js";
import { inspectProviderErrorEnvelope } from "./providerErrorRules.js";
import { parseRateLimitEvidence } from "../utils/error.js";

/**
 * Upstream status restatement — registry of gateways that misstate temporary
 * quota exhaustion as a non-retryable HTTP status.
 *
 * AgentRouter signals "user quota exhausted" with 403 (sometimes 400) and a
 * Chinese body ("用户额度不足" / "额度不足") instead of the standard 429. Clients
 * like Claude Code treat 403 as permanent and abort the whole session, and
 * our own fallback engine classifies it as AUTH_ERROR instead of a quota
 * event. `applyStatusRestatement()` rewrites such statuses to 429 with a
 * synthetic Retry-After before any downstream classification runs.
 *
 * `applyStatusRestatement()` is called from exactly one place: the
 * `!providerResponse.ok` block in `open-sse/handlers/chatCore.js`, right
 * after `parseUpstreamError()` populates `statusCode` / `message` /
 * `upstreamErrorBody` / `retryAfterMs`, and before `signatureRecovery` or any
 * other classification. Errors embedded inside a 200 SSE stream follow a
 * separate, later stream-parsing path and are NOT covered here today.
 *
 * Adding a future gateway with the same defect = register one rule array
 * below. No pipeline changes.
 *
 * Marker discipline: keep `textMarkers` provider-specific (the Chinese
 * strings are upstream error literals, not UI copy). Generic English phrases
 * like `insufficient_quota` are in `CREDITS_EXHAUSTED_SIGNALS` and would
 * flip the connection into a terminal `credits_exhausted` state — never use
 * them as markers here.
 *
 */import { isNumber, isString } from "@/shared/utils/typeChecks.js";

const AGENTROUTER_RULES = [
{
  id: "agentrouter-quota-misstatus",
  fromStatuses: new Set([403, 400]),
  toStatus: HTTP_STATUS.RATE_LIMITED,
  textMarkers: ["额度不足"],
  excludeMarkers: ["无权访问"],
  defaultRetryAfterMs: 60_000
}];


/** Provider id (lowercase) → ordered rules; first match wins. */
export const statusRestatementRegistry = new Map([
["agentrouter", AGENTROUTER_RULES]]
);

function matchesAgentrouterQuotaEnvelope(body) {
  const { message, type, code } = inspectProviderErrorEnvelope(body);
  if (message.includes("无权访问")) return false;
  if (!message.includes("额度不足")) return false;
  const quotaTypes = new Set(["quota_exhausted", "insufficient_user_quota"]);
  return (!type || quotaTypes.has(type)) && (!code || quotaTypes.has(code));
}

/** Parse bounded rate-limit timing after a status rule changes a response to 429. */
export function parseRestatedRateLimitEvidence({ status, headers, body, now = Date.now() }) {
  let bodyText = isString(body) ? body : "";
  if (!bodyText && body !== null && body !== undefined) {
    try {bodyText = JSON.stringify(body);} catch {/* keep empty bounded input */}
  }
  return parseRateLimitEvidence({ status, headers, bodyText, now });
}

/**
 * Restate a non-OK upstream status into a retryable 429 when the provider's
 * body text matches a registered quota-misstatus rule. Returns a passthrough
 * result (same status, `ruleId: null`) when no rule matches.
 *
 * @param {{
 *   provider: string | null | undefined,
 *   status: number,
 *   message?: string | null,
 *   body?: unknown,
 *   retryAfterMs?: number | null,
 * }} input
 * @returns {{ status: number, retryAfterMs: number | null, ruleId: string | null, fromStatus: number }}
 */
export function applyStatusRestatement(input) {
  const passthrough = {
    status: input.status,
    retryAfterMs: input.retryAfterMs ?? null,
    ruleId: null,
    fromStatus: input.status
  };
  if (!input.provider) return passthrough;
  const rules = statusRestatementRegistry.get(input.provider.toLowerCase());
  if (!rules) return passthrough;

  for (const rule of rules) {
    if (!rule.fromStatuses.has(input.status)) continue;
    if (!matchesAgentrouterQuotaEnvelope(input.body)) continue;
    const upstreamRetryAfterMs =
    isNumber(input.retryAfterMs) && input.retryAfterMs > 0 ? input.retryAfterMs : null;
    return {
      status: rule.toStatus,
      retryAfterMs: upstreamRetryAfterMs ?? rule.defaultRetryAfterMs ?? null,
      ruleId: rule.id,
      fromStatus: input.status
    };
  }
  return passthrough;
}
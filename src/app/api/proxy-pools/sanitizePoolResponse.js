import { sanitizeProxyPool } from "@/shared/utils/proxyUrlRedaction.js";
import { REDACTED_SECRET } from "@/shared/utils/secretRedaction.js";
import { isString } from "../../../shared/utils/typeChecks.js";

/**
 * Redact pool credentials for API responses. `relaySecret` is always replaced
 * (like other secrets), never echoed — even to an operator session.
 */
export function sanitizePoolResponse(pool, privileged) {
  const sanitized = sanitizeProxyPool(pool, privileged);
  if (!sanitized || !isString(sanitized.relaySecret) || sanitized.relaySecret === "") {
    return sanitized;
  }
  return { ...sanitized, relaySecret: REDACTED_SECRET };
}

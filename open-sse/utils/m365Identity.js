/**
 * Microsoft 365 account identity read from a BizChat access token.
 *
 * The claims are decoded, never verified: they pick routing (the Chathub path and the tenant
 * a refresh is sent to) and display metadata, and are never an authorization decision.
 */
import { isRecord, isString } from "../../src/shared/utils/typeChecks.js";
import { M365_CONSUMER_TENANT_ID, isM365Guid } from "../config/copilotM365.js";

const NIL_GUID = /^0{8}-0{4}-0{4}-0{4}-0{12}$/;

/** The JWT payload, or null for an opaque token (the individual tier issues JWE). */
export function decodeM365JwtClaims(token) {
  if (!isString(token)) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return isRecord(payload) ? payload : null;
  } catch {
    return null;
  }
}

/** Display metadata only: rejects markup and control characters. */
function displayClaim(value) {
  if (!isString(value) || !value.trim() || value.length > 254) return null;
  if (/[<>\p{Cc}\p{Cf}]/u.test(value)) return null;
  return value.trim();
}

/**
 * `{ oid, tid, chathubPath, email, name }` of a work or school account, or null. The consumer
 * tenant and nil ids are refused: native sign-in is for the BizChat work/school surface.
 */
export function m365IdentityFromAccessToken(token) {
  const claims = decodeM365JwtClaims(token);
  if (!claims || !isM365Guid(claims.oid) || !isM365Guid(claims.tid)) return null;
  const oid = claims.oid.toLowerCase();
  const tid = claims.tid.toLowerCase();
  if (tid === M365_CONSUMER_TENANT_ID || NIL_GUID.test(tid) || NIL_GUID.test(oid)) return null;
  const emailCandidate = displayClaim(claims.preferred_username) || displayClaim(claims.email);
  const email = emailCandidate && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailCandidate) ? emailCandidate : null;
  return { oid, tid, chathubPath: `${oid}@${tid}`, email, name: displayClaim(claims.name) };
}

/**
 * The tenant a connection's refresh is routed to: its stored tenant or Chathub path first, then
 * the access token's `tid`, then `common`. Null for an invalid explicit hint, so a bad value is
 * refused rather than spliced into a credential-bearing URL.
 */
export function m365RefreshTenant(credentials) {
  const psd = isRecord(credentials?.providerSpecificData) ? credentials.providerSpecificData : {};
  for (const key of ["tenantId", "tid"]) {
    if (Object.hasOwn(psd, key)) return isM365Guid(psd[key]) ? psd[key].toLowerCase() : null;
  }
  for (const key of ["chathubPath", "userTenant"]) {
    if (Object.hasOwn(psd, key)) {
      const tenant = isString(psd[key]) ? psd[key].split("@")[1] : "";
      return isM365Guid(tenant) ? tenant.toLowerCase() : null;
    }
  }
  const claims = decodeM365JwtClaims(credentials?.accessToken);
  return isM365Guid(claims?.tid) ? claims.tid.toLowerCase() : "common";
}

/**
 * Muse Code inference-key mint and remint.
 *
 * Muse Code has no refresh-token grant. The device login's `dca:` token is the
 * durable credential (stored as `refreshToken` and `providerSpecificData.dcaToken`);
 * the inference key is minted from it and reminted whenever it is missing or
 * rejected.
 */
import { MUSE_CODE_MINT_URL, isMuseDcaToken, museCodeHeaders } from "../config/museCode.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { isBoolean, isString } from "../../src/shared/utils/typeChecks.js";

const text = (value) => isString(value) && value.trim() ? value.trim() : undefined;
const bool = (value) => isBoolean(value) ? value : undefined;

/**
 * Exchange a `dca:` token for the subscription inference key.
 * @returns {Promise<{apiKey: string, email?: string, name?: string, subsTierName?: string, isSubsActive?: boolean}>}
 */
export async function mintMuseApiKey(dcaToken, proxyOptions = null) {
  const token = text(dcaToken);
  if (!token) throw new Error("Muse Code mint requires a device access token.");
  const response = await proxyAwareFetch(MUSE_CODE_MINT_URL, {
    method: "POST",
    headers: museCodeHeaders({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" }),
    body: JSON.stringify({ dca_token: token })
  }, proxyOptions);
  if (!response.ok) {
    try {await response.body?.cancel?.();} catch {/* best effort */}
    throw new Error(`Muse Code key mint failed (HTTP ${response.status}).`);
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("Muse Code key mint response was not JSON.");
  }
  const apiKey = text(data?.api_key) || text(data?.apiKey);
  if (!apiKey) throw new Error("Muse Code key mint response missing api_key.");
  return {
    apiKey,
    email: text(data.user_email) || text(data.email),
    name: text(data.user_full_name) || text(data.name),
    subsTierName: text(data.subs_tier_name),
    isSubsActive: bool(data.is_subs_active)
  };
}

/** Subscription metadata kept on the connection after a mint. */
export function museMintMetadata(minted) {
  return {
    subsTierName: minted?.subsTierName,
    isSubsActive: minted?.isSubsActive,
    lastRefresh: new Date().toISOString()
  };
}

/**
 * Remint the inference key from the stored `dca:` token.
 * @returns {Promise<{accessToken: string, refreshToken: string, providerSpecificData: object}|null>}
 */
export async function refreshMuseCodeToken(refreshToken, providerSpecificData, log, proxyOptions = null) {
  const stored = providerSpecificData?.dcaToken;
  const dcaToken = isMuseDcaToken(stored) ? stored.trim() : isMuseDcaToken(refreshToken) ? refreshToken.trim() : "";
  if (!dcaToken) {
    log?.warn?.("TOKEN_REFRESH", "Muse Code connection has no dca token; sign in again");
    return null;
  }
  try {
    const minted = await mintMuseApiKey(dcaToken, proxyOptions);
    return {
      accessToken: minted.apiKey,
      refreshToken: dcaToken,
      providerSpecificData: { ...museMintMetadata(minted), dcaToken }
    };
  } catch (error) {
    log?.warn?.("TOKEN_REFRESH", `Muse Code remint failed: ${error?.message || "error"}`);
    return null;
  }
}

import { buildKiroProfileEndpoint } from "../../../open-sse/config/kiroRegions.js";
import { ANTHROPIC_API_VERSION } from "../../../open-sse/providers/shared.js";
import { isBoolean, isString } from "../../shared/utils/typeChecks.js";

const BASE64_BLOCK_SIZE = 4;
const AWS_REGION_PATTERN = /^[a-z]{2}-[a-z]+-\d{1,2}$/;

function validateXaiOAuthEndpoint(rawUrl, field) {
  const value = String(rawUrl || "").trim();
  if (!value) throw new Error(`xai discovery ${field} is empty`);
  let parsed;
  try {parsed = new URL(value);} catch (err) {
    throw new Error(`xai discovery ${field} is invalid: ${err.message}`);
  }
  if (parsed.protocol !== "https:") throw new Error(`xai discovery ${field} must use https: ${value}`);
  const host = parsed.hostname.toLowerCase().trim();
  if (host !== "x.ai" && !host.endsWith(".x.ai")) {
    throw new Error(`xai discovery ${field} host ${host} is not on x.ai`);
  }
  return value;
}

function decodeXaiIdTokenEmail(idToken) {
  if (!idToken || !isString(idToken)) return undefined;
  const parts = idToken.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padding = (BASE64_BLOCK_SIZE - base64.length % BASE64_BLOCK_SIZE) % BASE64_BLOCK_SIZE;
    const json = Buffer.from(base64 + "=".repeat(padding), "base64").toString("utf8");
    const payload = JSON.parse(json);
    return payload.email || payload.preferred_username || payload.sub || undefined;
  } catch {
    return undefined;
  }
}

function decodeJwtPayload(jwt) {
  try {
    if (!jwt || !isString(jwt)) return null;
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const missingPadding = (BASE64_BLOCK_SIZE - base64.length % BASE64_BLOCK_SIZE) % BASE64_BLOCK_SIZE;
    const padded = base64 + "=".repeat(missingPadding);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function extractEmailFromAccessToken(accessToken) {
  const payload = decodeJwtPayload(accessToken);
  if (!payload) return undefined;
  return payload.email || payload.preferred_username || payload.sub || undefined;
}

export async function fetchKiroProfileArn(accessToken, region = "us-east-1", proxyOptions = null) {
  if (!accessToken) return null;
  const safeRegion = isString(region) && AWS_REGION_PATTERN.test(region) ? region : "us-east-1";
  const endpoint = `${buildKiroProfileEndpoint(safeRegion)}`;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.0",
        "x-amz-target": "AmazonCodeWhispererService.ListAvailableProfiles",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({ maxResults: 10 }),
      // Route Kiro profile discovery through the OAuth-selected proxy pool.
      proxyOptions
    });
    if (!response.ok) {
      if (proxyOptions?.strictProxy === true) {
        throw new Error(`Kiro profile discovery failed: HTTP ${response.status}`);
      }
      return null;
    }
    const data = await response.json();
    const profiles = Array.isArray(data?.profiles) ? data.profiles : [];
    // Prefer a profile whose ARN region matches the caller's region — IDC users
    // in eu-west-1 / ap-southeast-1 must not be pinned to a us-east-1 profile.
    const arnOf = (p) => (p?.arn || p?.profileArn || "").trim() || null;
    const inRegion = profiles.find((p) => arnOf(p)?.split(":")[3] === safeRegion);
    return arnOf(inRegion) || arnOf(profiles[0]) || null;
  } catch (error) {
    // A selected strict pool is a security boundary: transport failures must
    // abort the OAuth flow instead of being converted into a best-effort miss.
    if (proxyOptions?.strictProxy === true) throw error;
    return null;
  }
}

export function extractCodexAccountInfo(idToken) {
  const payload = decodeJwtPayload(idToken);
  if (!payload) return {};
  const chatgpt = payload["https://api.openai.com/auth"] || {};
  return {
    email: payload.email,
    chatgptAccountId: chatgpt.chatgpt_account_id || payload.account_id,
    chatgptPlanType: chatgpt.chatgpt_plan_type || payload.plan_type
  };
}

/**
 * Fetch the Claude OAuth profile (account email + organization plan tier).
 *
 * Best-effort by design: a missing or failed profile must never fail the OAuth
 * connect, since the tokens themselves are already valid at this point. The one
 * exception is a strict proxy pool — that is a security boundary, so a transport
 * failure there aborts rather than silently egressing or degrading, matching
 * `fetchKiroProfileArn` above.
 *
 * @param {string} accessToken - freshly exchanged Claude OAuth access token
 * @param {string} profileUrl - `oauth.profileUrl` from the claude registry
 * @param {object|null} [proxyOptions] - OAuth-selected outbound proxy pool
 * @returns {Promise<object|null>} raw profile payload, or null when unavailable
 */
export async function fetchClaudeProfile(accessToken, profileUrl, proxyOptions = null) {
  if (!accessToken || !profileUrl) return null;
  try {
    const response = await fetch(profileUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        "anthropic-version": ANTHROPIC_API_VERSION
      },
      proxyOptions
    });
    if (!response.ok) {
      if (proxyOptions?.strictProxy === true) {
        throw new Error(`Claude profile fetch failed: HTTP ${response.status}`);
      }
      return null;
    }
    return await response.json();
  } catch (error) {
    if (proxyOptions?.strictProxy === true) throw error;
    return null;
  }
}

/**
 * Connection fields derived from a Claude OAuth profile reply.
 *
 * Returns `{}` for a missing or unusable profile so callers can spread it blindly.
 * Only `email`/`displayName` reach the client (both are already in the connection
 * sanitizer's allowlist); the organization and account identifiers live under
 * `providerSpecificData`, which the sanitizer never exposes.
 *
 * @param {object|null} profile - payload from `fetchClaudeProfile`
 * @returns {object} connection patch fields
 */
export function claudeProfileFields(profile) {
  const account = profile?.account;
  const org = profile?.organization;
  if (!account && !org) return {};

  const fields = {};
  if (account?.email) fields.email = account.email;
  const displayName = account?.display_name || account?.full_name;
  if (displayName) fields.displayName = displayName;

  const providerSpecificData = {};
  if (account?.uuid) providerSpecificData.claudeAccountUuid = account.uuid;
  if (isBoolean(account?.has_claude_max)) providerSpecificData.claudeHasMax = account.has_claude_max;
  if (isBoolean(account?.has_claude_pro)) providerSpecificData.claudeHasPro = account.has_claude_pro;
  if (org?.uuid) providerSpecificData.claudeOrgUuid = org.uuid;
  if (org?.name) providerSpecificData.claudeOrgName = org.name;
  if (org?.organization_type) providerSpecificData.claudeOrgType = org.organization_type;
  if (org?.rate_limit_tier) providerSpecificData.claudeRateLimitTier = org.rate_limit_tier;
  if (Object.keys(providerSpecificData).length) fields.providerSpecificData = providerSpecificData;

  return fields;
}


export {
  BASE64_BLOCK_SIZE,
  validateXaiOAuthEndpoint,
  decodeXaiIdTokenEmail,
  decodeJwtPayload,
  extractEmailFromAccessToken };
import { isNumber, isRecord, isString } from "../../src/shared/utils/typeChecks.js";

// Cloud Code project, tier and operation parsing follows CLIProxyAPI (MIT),
// internal/auth/antigravity/auth.go at 6eb8554f0ede.
function trimmedString(value) {
  return isString(value) ? value.trim() : "";
}

export function extractAntigravityProject(data) {
  for (const key of ["cloudaicompanionProject", "projectId", "project"]) {
    const value = data?.[key];
    const id = trimmedString(value) || trimmedString(value?.id);
    if (id) return id;
  }
  return "";
}

export function extractAntigravityOnboardTier(data) {
  if (Array.isArray(data?.allowedTiers)) {
    for (const tier of data.allowedTiers) {
      if (tier?.isDefault === true && trimmedString(tier.id)) return tier.id.trim();
    }
  }
  return trimmedString(data?.currentTier?.id) || "free-tier";
}

export const ANTIGRAVITY_AGE_VERIFICATION_URL = "https://myaccount.google.com/age-verification";

/**
 * For a loadCodeAssist answer with no project: an age-restricted account cannot be onboarded
 * until Google verifies its age (OmniRoute #19621). A default tier that provisions its own
 * project is still onboarded. Returns the error to throw, or null.
 */
export function antigravityAgeRestrictionError(data) {
  const restricted = Array.isArray(data?.ineligibleTiers) &&
  data.ineligibleTiers.some((tier) => tier?.reasonCode === "RESTRICTED_AGE");
  if (!restricted) return null;
  const managedTier = Array.isArray(data.allowedTiers) &&
  data.allowedTiers.some((tier) => tier?.isDefault === true && !tier.userDefinedCloudaicompanionProject);
  if (managedTier) return null;
  return Object.assign(new Error(
    `Google requires age verification for this account (RESTRICTED_AGE). Verify at ${ANTIGRAVITY_AGE_VERIFICATION_URL} with the same Google account, then try again.`
  ), { status: 403, credentialScoped: true });
}

export function antigravityOnboardOperationError(raw) {
  if (raw == null) return null;
  if (isString(raw) && !raw.trim()) return null;

  let details = isString(raw) ? raw.trim() : JSON.stringify(raw);
  let status = 502;
  if (isRecord(raw)) {
    if (!Object.keys(raw).length) return null;
    const code = isNumber(raw.code) && raw.code !== 0 ? raw.code : null;
    const name = trimmedString(raw.status) || ({
      3: "INVALID_ARGUMENT",
      7: "PERMISSION_DENIED",
      8: "RESOURCE_EXHAUSTED",
      16: "UNAUTHENTICATED"
    })[code];
    const normalized = name?.toUpperCase();
    if (code === 7 || code === 403 || normalized === "PERMISSION_DENIED") status = 403;
    else if (code === 8 || code === 429 || normalized === "RESOURCE_EXHAUSTED") status = 429;
    else if (code === 16 || code === 401 || normalized === "UNAUTHENTICATED") status = 401;
    details = [code != null ? `code ${code}` : "", name, trimmedString(raw.message)].filter(Boolean).join(": ") || details;
  }
  return Object.assign(new Error(`Antigravity onboarding operation error: ${details}`), {
    status,
    credentialScoped: true
  });
}

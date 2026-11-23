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

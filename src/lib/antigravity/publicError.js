export const ANTIGRAVITY_ERROR_CATEGORIES = Object.freeze([
  "invalid_grant",
  "reauth_required",
  "challenge",
  "consent",
  "account_mismatch",
  "network",
  "rate_limit",
  "uncertain_dispatch",
  "lease_lost",
  "browser_unavailable",
  "encryption",
  "busy",
  "budget_exhausted",
  "pre_dispatch_failure",
]);

const ALLOWED = new Set(ANTIGRAVITY_ERROR_CATEGORIES);

export function publicCategory(value) {
  return ALLOWED.has(value) ? value : "pre_dispatch_failure";
}

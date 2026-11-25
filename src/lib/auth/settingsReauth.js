// Settings changes that weaken the instance or change who can sign in need the
// current dashboard password as well as the session (decolua/9router#4286).

/** Body `code` of the 401 that asks the dashboard to prompt and retry. */
export const REAUTH_REQUIRED_CODE = "REAUTH_REQUIRED";

const SIGN_IN_KEYS = [
  "authMode", "ssoType", "oidcIssuerUrl", "oidcClientId", "oidcClientSecret", "oidcScopes",
  "oidcAllowedSubjects", "oidcAllowedEmails", "oidcAllowedDomains",
];

/** Unset, "" and [] all mean "nothing stored"; list order is not a change. */
const comparable = (value) => {
  if (Array.isArray(value)) return value.length ? JSON.stringify([...value].sort()) : "";
  return value ?? "";
};

/**
 * Keys in `updates` that require the password. Turning protection on and
 * re-saving the stored value never do.
 *
 * @param {object} updates Normalized settings PATCH body.
 * @param {object} current Stored settings.
 * @returns {string[]}
 */
export function reauthRequiredKeys(updates, current) {
  const has = (key) => Object.hasOwn(updates, key);
  const keys = [];
  for (const key of ["requireLogin", "requireApiKey"]) {
    if (has(key) && updates[key] === false && current?.[key] !== false) keys.push(key);
  }
  if (has("tunnelDashboardAccess") && updates.tunnelDashboardAccess === true && current?.tunnelDashboardAccess !== true) {
    keys.push("tunnelDashboardAccess");
  }
  return keys.concat(SIGN_IN_KEYS.filter((key) => has(key) && comparable(updates[key]) !== comparable(current?.[key])));
}

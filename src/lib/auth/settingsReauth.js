// Settings changes that weaken the instance, redirect or record traffic, or
// change who can sign in need the current dashboard password (plus the second
// factor when MFA is on) as well as the session (decolua/9router#4286, #2579).

/** Body `code` of the 401 that asks the dashboard to prompt and retry. */
export const REAUTH_REQUIRED_CODE = "REAUTH_REQUIRED";

const SIGN_IN_KEYS = [
  "authMode", "ssoType", "oidcIssuerUrl", "oidcClientId", "oidcClientSecret", "oidcScopes",
  "oidcAllowedSubjects", "oidcAllowedEmails", "oidcAllowedDomains",
];

// Switches whose "on" state exposes the instance or its traffic.
const WIDENING_SWITCHES = [
  "tunnelDashboardAccess", "lanDiscoveryEnabled", "headroomEnabled", "headroomCompressUserMessages",
  "outboundProxyEnabled", "enableSessionCapture", "logToolSources", "enableObservability",
];

// Values that decide where traffic goes: any change counts.
const ROUTING_KEYS = ["headroomUrl", "outboundProxyUrl", "outboundNoProxy", "mitmRouterBaseUrl"];

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
  // Truthiness, not `=== true`: not every switch is type-checked before this.
  for (const key of WIDENING_SWITCHES) {
    if (has(key) && Boolean(updates[key]) && updates[key] !== current?.[key]) keys.push(key);
  }
  const changed = (key) => has(key) && comparable(updates[key]) !== comparable(current?.[key]);
  return keys.concat([...SIGN_IN_KEYS, ...ROUTING_KEYS].filter(changed));
}

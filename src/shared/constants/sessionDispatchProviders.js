/**
 * Providers that re-serve an account's plan through the gateway and stay off
 * until a connection opts in with `providerSpecificData.enableSessionDispatch`
 * set to the boolean `true` (#2034). The executors enforce the guard; the
 * dashboard uses this set to offer the per-connection toggle, which defaults
 * to off. Sign-in and key import never set it.
 */
export const SESSION_DISPATCH_OPT_IN_KEY = "enableSessionDispatch";

export const SESSION_DISPATCH_PROVIDERS = Object.freeze(new Set([
  "cursor-api",
  "devin-desktop",
  "freebuff",
  "minimax-code",
  "muse-spark-web",
  "workbuddy",
  "zed-hosted",
]));

export function isSessionDispatchProvider(providerId) {
  return SESSION_DISPATCH_PROVIDERS.has(providerId);
}

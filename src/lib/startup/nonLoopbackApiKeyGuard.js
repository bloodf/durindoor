// Boot-time guard: the dashboard/API server binds loopback by default
// (`scripts/next-owner-server.cjs` falls back to `127.0.0.1`), but an
// operator can set `HOSTNAME=0.0.0.0` (or any LAN/WAN address) to expose it
// deliberately. When they do, and `requireApiKey` is off, the anonymous
// `/v1` LLM proxy is reachable from every interface the host has. This never
// blocks boot — a reverse proxy in front of DurinDoor may already enforce
// its own authentication — it only logs a loud warning so the operator
// notices the exposure instead of discovering it from unexplained usage.
//
// Ported from OmniRoute's nonLoopbackApiKeyGuard.ts (#13820), adapted to the
// fork's settings-backed `requireApiKey` flag (DB, not env) and its
// loopback-by-default bind host (env `HOSTNAME`, not `HOST`).

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost", "::ffff:127.0.0.1"]);

export const DEFAULT_SERVER_HOST = "127.0.0.1";

function isLoopbackHost(host) {
  return LOOPBACK_HOSTS.has(String(host).trim().toLowerCase());
}

/**
 * Host the dashboard/API server (serves `/v1` inference) is bound to.
 * Mirrors `scripts/next-owner-server.cjs`'s own resolution so the warning
 * never names an interface the server is not actually on.
 */
export function resolveServerHost() {
  return process.env.HOSTNAME || DEFAULT_SERVER_HOST;
}

/**
 * Logs a warning when `host` resolves to a non-loopback interface while
 * `requireApiKey` is off. Never throws and never blocks startup.
 */
export function warnIfNonLoopbackWithoutApiKey(serverLabel, host, requireApiKey) {
  if (isLoopbackHost(host)) return;
  if (requireApiKey === true) return;

  console.warn(
    `[startup] ${serverLabel} is bound to non-loopback host "${host}" while ` +
      "requireApiKey is disabled — this exposes the anonymous /v1 proxy to " +
      "every reachable network interface. Enable \"Require API key\" in " +
      "dashboard settings, or bind back to 127.0.0.1 (unset HOSTNAME), " +
      "unless a reverse proxy in front of this instance already enforces " +
      "its own authentication."
  );
}

/**
 * Warn when the dashboard/API server that answers `/v1` inference is
 * reachable off-box without an API key. Dynamic import: settingsRepo pulls
 * in the sqlite adapter, which is Node-only and must not be reachable from
 * the edge bundle at parse time (see src/instrumentation.js).
 */
export async function warnIfInferenceServerExposed() {
  let requireApiKey = false;
  try {
    const { getSettingsSync } = await import("@/lib/db/repos/settingsRepo.js");
    requireApiKey = getSettingsSync()?.requireApiKey === true;
  } catch (error) {
    console.log(`[startup] exposure check skipped: ${error?.message || error}`);
    return;
  }
  warnIfNonLoopbackWithoutApiKey(
    "Dashboard/API server (serves /v1 inference)",
    resolveServerHost(),
    requireApiKey
  );
}

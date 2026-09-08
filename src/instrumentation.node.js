// Node.js-runtime half of the Next.js startup hook.
//
// Why this file exists: Next.js compiles `src/instrumentation.js` once per
// runtime. Because `src/proxy.js` (the Next 16 middleware convention) keeps
// an edge entry alive, the edge compiler bundles instrumentation.js too —
// and webpack follows `await import(...)` regardless of runtime `if` guards.
// Any Node built-in (`os`, `fs`, `child_process`, `node:*`, `bun:sqlite`)
// reachable from instrumentation.js therefore breaks the edge bundle and the
// whole dev server 500s (regression from d9c5594e).
//
// The escape hatch is Next's per-compiler DefinePlugin: `NEXT_RUNTIME` is a
// compile-time string literal ("nodejs" / "edge"), so `await import()` calls
// inside `if (process.env.NEXT_RUNTIME === "nodejs")` are constant-folded out
// of the edge bundle. This module is only reachable through that guarded
// import, so it may freely use Node-only modules.

/**
 * Recreate the DurinDoor-managed Headroom proxy when the gateway boots.
 *
 * The proxy is a child of the gateway, so a systemd restart reaps it with the
 * rest of the cgroup (`detached: true` does not escape one) and a container
 * restart drops it entirely. Without this the proxy stays down for the rest of
 * the gateway's uptime and compression fails open silently.
 *
 * Deliberately narrow: it never installs Headroom and never enables it. It only
 * revives a proxy the operator already turned on, so opting in stays an explicit
 * action through Auto-configure.
 */
export async function ensureHeadroomProxy() {
  const { getSettings } = await import("@/lib/db/repos/settingsRepo.js");
  const settings = await getSettings();
  if (!settings?.headroomEnabled) return;

  const { DEFAULT_HEADROOM_URL, isLoopbackHeadroomUrl } = await import("@/lib/headroom/detect.js");
  const url = settings.headroomUrl || DEFAULT_HEADROOM_URL;
  // A remote proxy belongs to whoever operates it; we only manage our own.
  if (!isLoopbackHeadroomUrl(url)) return;

  const { startHeadroomProxy, getManagedPid } = await import("@/lib/headroom/process.js");
  if (getManagedPid()) return;

  const port = Number.parseInt(new URL(url).port, 10) || 8787;
  const { pid } = await startHeadroomProxy({ port });
  console.log(`[headroom] proxy autostarted on ${url} (pid ${pid})`);
}

/**
 * Node.js-only boot work: rename the process and revive the Headroom proxy.
 * Only ever called from the guarded block in instrumentation.js.
 */
export function bootstrapNodejsRuntime() {
  // Rename process to distinguish 9router from generic next-server
  if (process.title.startsWith("next-server")) {
    process.title = process.title.replace("next-server", "9router");
  }

  // Not awaited on purpose. startHeadroomProxy holds an 8s startup probe, and
  // blocking `register()` on it would add that delay to every gateway boot.
  // Fail-open: a compression proxy must never keep the gateway from starting.
  void ensureHeadroomProxy().catch((error) => {
    console.log(`[headroom] proxy autostart skipped: ${error?.message || error}`);
  });

  // Hourly sweep of old local data; a no-op until the operator enables it.
  void import("@/lib/dataRetention/scheduler.js")
    .then(({ startDataRetentionScheduler }) => startDataRetentionScheduler())
    .catch((error) => {
      console.log(`[data-retention] scheduler not started: ${error?.message || error}`);
    });
}

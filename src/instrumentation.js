// Next.js startup hook. Runs once per server start in every deployment shape
// (systemd, Docker, `npm start`, dev), which is why the Headroom proxy is
// revived from here rather than from host-specific service wiring.

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

export function register() {
  // Rename process to distinguish 9router from generic next-server
  if (process.title.startsWith('next-server')) {
    process.title = process.title.replace('next-server', '9router');
  }

  // Node-only: the edge runtime cannot spawn processes or reach the database.
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return;

  // Not awaited on purpose. startHeadroomProxy holds an 8s startup probe, and
  // blocking `register()` on it would add that delay to every gateway boot.
  // Fail-open: a compression proxy must never keep the gateway from starting.
  void ensureHeadroomProxy().catch((error) => {
    console.log(`[headroom] proxy autostart skipped: ${error?.message || error}`);
  });
}

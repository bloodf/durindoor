#!/usr/bin/env node
/**
 * Start the DurinDoor-managed Headroom compression proxy.
 *
 * The proxy is spawned by DurinDoor (never as an independent service) so it
 * shares the gateway's lifecycle: it lives in the same systemd cgroup, is torn
 * down with the gateway, and is recreated on every start. Without this the
 * proxy dies on `systemctl restart` (KillMode=control-group reaps the whole
 * cgroup, which `detached: true` does not escape) and nothing brings it back —
 * compression then fails open silently for the rest of the gateway's uptime.
 *
 * Wire this as an ExecStartPost of the gateway unit. It is intentionally
 * fail-open and always exits 0: a compression proxy must never block the
 * gateway from starting.
 */
import { register } from "node:module";

register(new URL("./alias-loader.mjs", import.meta.url));

const log = (message) => process.stdout.write(`[start-headroom] ${message}\n`);

async function main() {
  const { getSettings } = await import("../src/lib/db/repos/settingsRepo.js");
  const { startHeadroomProxy, getManagedPid } = await import("../src/lib/headroom/process.js");
  const { DEFAULT_HEADROOM_URL, isLoopbackHeadroomUrl } = await import("../src/lib/headroom/detect.js");

  const settings = await getSettings();
  if (!settings?.headroomEnabled) {
    log("headroom disabled in settings; nothing to start");
    return;
  }

  const url = settings.headroomUrl || DEFAULT_HEADROOM_URL;
  if (!isLoopbackHeadroomUrl(url)) {
    log(`headroom URL ${url} is remote; DurinDoor does not manage external proxies`);
    return;
  }

  const existing = getManagedPid();
  if (existing) {
    log(`headroom proxy already running (pid ${existing})`);
    return;
  }

  const port = Number.parseInt(new URL(url).port, 10) || 8787;
  const { pid, alreadyRunning } = await startHeadroomProxy({ port });
  log(alreadyRunning ? `headroom proxy already running (pid ${pid})` : `started headroom proxy on ${url} (pid ${pid})`);
}

try {
  await main();
} catch (error) {
  // Fail-open: never block gateway startup on the compression proxy.
  log(`skipped: ${error?.message || error}`);
}

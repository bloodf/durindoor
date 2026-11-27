import { resolveCompressionConfig } from "./shared/utils/compressionConfig.js";
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

import { runStartupTasks } from "@/lib/startup/startupTasks.js";

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
  const settings = resolveCompressionConfig(await getSettings());
  if (!settings.headroomEnabled) return;

  const { isLoopbackHeadroomUrl } = await import("@/lib/headroom/detect.js");
  const url = settings.headroomUrl;
  // A remote proxy belongs to whoever operates it; we only manage our own.
  if (!isLoopbackHeadroomUrl(url)) return;

  const { startHeadroomProxy, getManagedPid } = await import("@/lib/headroom/process.js");
  if (getManagedPid()) return;

  const port = Number.parseInt(new URL(url).port, 10) || 8787;
  const { pid } = await startHeadroomProxy({ port });
  console.log(`[headroom] proxy autostarted on ${url} (pid ${pid})`);
}

/**
 * Node.js-only boot work: rename the process, revive the Headroom proxy and
 * start the background schedulers.
 * Only ever called from the guarded block in instrumentation.js.
 */
export function bootstrapNodejsRuntime() {
  if (["phase-production-build", "phase-export", "phase-static"].includes(process.env.NEXT_PHASE) ||
      process.env.DURINDOOR_BUILD === "1" || process.env.npm_lifecycle_event === "build") return;

  const startupTasks = [
    {
      name: "runtime bootstrap",
      loader: () => import("./shared/services/bootstrap.js"),
      run: ({ bootstrapRuntime }) => bootstrapRuntime(),
    },
  ];

  // Rename process to distinguish 9router from generic next-server
  if (process.title.startsWith("next-server")) {
    process.title = process.title.replace("next-server", "9router");
  }

  // The process-global recorder is idempotent across repeated boot calls and
  // module reloads. Its unref'd timer does not hold the process open at exit.
  startupTasks.push({
    name: "operational metrics",
    loader: () => import("../open-sse/services/operationalMetrics.js"),
    run: ({ startOperationalMetricsRuntime }) => startOperationalMetricsRuntime(),
  });

  // Warn when the server that answers /v1 inference is bound to a
  // non-loopback interface (HOSTNAME=0.0.0.0 or a LAN/WAN address) while
  // "Require API key" is off — the anonymous proxy is then reachable from
  // every interface the host has. Runs early so it is not buried in the
  // boot log; never blocks startup (ported from OmniRoute #13820).
  startupTasks.push({
    name: "exposure check",
    loader: () => import("@/lib/startup/nonLoopbackApiKeyGuard.js"),
    run: ({ warnIfInferenceServerExposed }) => warnIfInferenceServerExposed(),
  });

  // Not awaited on purpose. startHeadroomProxy holds an 8s startup probe, and
  // blocking `register()` on it would add that delay to every gateway boot.
  // Fail-open: a compression proxy must never keep the gateway from starting.
  startupTasks.push({
    name: "Headroom proxy",
    loader: async () => ({ ensureHeadroomProxy }),
    run: ({ ensureHeadroomProxy: startProxy }) => startProxy(),
  });

  // Provider metadata imports are inert. Start release refresh only when the
  // Node server boots, across dev, production and the packaged CLI server.
  startupTasks.push({
    name: "Kimchi user agent updater",
    loader: () => import("../open-sse/utils/kimchiUserAgent.js"),
    run: ({ startKimchiUserAgentUpdater }) => startKimchiUserAgentUpdater(),
  });

  // Hourly sweep of old local data; a no-op until the operator enables it.
  startupTasks.push({
    name: "data retention scheduler",
    loader: () => import("@/lib/dataRetention/scheduler.js"),
    run: ({ startDataRetentionScheduler }) => startDataRetentionScheduler(),
  });

  // Model auto-sync: refresh provider model catalogs shortly after boot and on
  // the configured interval. Failures stay per provider and never block boot.
  startupTasks.push({
    name: "model auto-sync scheduler",
    loader: () => import("@/lib/modelAutoSync/scheduler.js"),
    run: ({ startModelAutoSyncScheduler }) => startModelAutoSyncScheduler(),
  });

  runStartupTasks(startupTasks);
}

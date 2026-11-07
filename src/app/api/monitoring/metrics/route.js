import { hasValidCliToken, hasValidToken, isAdminScopedKey } from "@/dashboardGuard";
import { getActiveRequests } from "@/lib/db/index.js";
import { getGateStats } from "open-sse/services/concurrencyGate.js";
import { getEventLoopSampler, operationalMetricsText } from "open-sse/services/operationalMetrics.js";

export const dynamic = "force-dynamic";

// One unref'd histogram per process, including across development module reloads.
const sampler = getEventLoopSampler();

export async function GET(request) {
  if (!(await hasValidCliToken(request)) && !(await isAdminScopedKey(request)) && !(request.cookies && await hasValidToken(request))) {
    return new Response("Unauthorized\n", { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const { activeRequests } = await getActiveRequests();
    if (!Array.isArray(activeRequests) || activeRequests.some((item) => !Number.isSafeInteger(item?.count) || item.count < 0)) {
      throw new Error("Invalid active request snapshot");
    }
    const count = activeRequests.reduce((sum, item) => sum + item.count, 0);
    if (!Number.isSafeInteger(count)) throw new Error("Invalid active request total");
    const queued = Object.values(getGateStats()).reduce((sum, gate) => sum + gate.queued, 0);
    if (!Number.isSafeInteger(queued) || queued < 0) throw new Error("Invalid admission queue total");
    const uptime = process.uptime();
    const rss = process.memoryUsage().rss;
    if (!Number.isFinite(uptime) || uptime < 0 || !Number.isSafeInteger(rss) || rss < 0) throw new Error("Invalid process snapshot");
    const delay = sampler.percentile(99) / 1e9;
    const body = [
      "# TYPE durindoor_active_requests gauge",
      `durindoor_active_requests ${count}`,
      "# TYPE durindoor_admission_queued_requests gauge",
      `durindoor_admission_queued_requests ${queued}`,
      "# TYPE durindoor_process_uptime_seconds gauge",
      `durindoor_process_uptime_seconds ${uptime}`,
      "# TYPE durindoor_process_resident_memory_bytes gauge",
      `durindoor_process_resident_memory_bytes ${rss}`,
      ...(sampler.count > 0 && Number.isFinite(delay) && delay >= 0 ? [
        "# TYPE durindoor_event_loop_delay_p99_seconds gauge",
        `durindoor_event_loop_delay_p99_seconds ${delay}`,
      ] : []),
      operationalMetricsText(),
      "",
    ].join("\n");
    return new Response(body, { headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8", "Cache-Control": "no-store" } });
  } catch {
    return new Response("Metrics unavailable\n", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

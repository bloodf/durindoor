// Website-only monitoring fixture derived from the same usage samples as the dashboard.
import { requestEvents } from "./live.js";
import { buildStats } from "./aggregate.js";
import { DEMO_VERSION } from "../../fixtures/world.js";
export default function registerMonitoring(router, { store }) {
  router.get("/api/monitoring", () => {
    const today = buildStats(store, "24h");
    const week = buildStats(store, "7d");
    const recent = week.recentRequests;
    const events = requestEvents(store);
    const failures = events.filter(
      (event) =>
        event.httpStatus >= 400 &&
        Date.parse(event.timestamp) >= Date.now() - 7 * 86400000,
    );
    const health = Object.entries(week.byProvider).map(([id, row]) => {
      const errors = failures.filter((event) => event.provider === id).length;
      const requests = row.requests + errors;
      return {
        id,
        name: id,
        requests,
        errors,
        successRate: requests ? ((requests - errors) / requests) * 100 : null,
        lastUsed:
          recent.find((event) => event.provider === id)?.timestamp || null,
      };
    });
    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      latencyMs: 0,
      version: DEMO_VERSION,
      runtime: {
        activeRequests: week.activeRequests.reduce(
          (sum, row) => sum + (row.count || 0),
          0,
        ),
        activeDetail: week.activeRequests,
        pending: 0,
        errorProvider: week.errorProvider,
        processUptimeSec: 0,
        memoryRssMB: 0,
        nodeVersion: "sample",
        dbSizeLabel: "sample",
        dbPath: "browser-local sample data",
        dataDir: "browser-local sample data",
      },
      activity: {
        today: {
          requests: today.totalRequests,
          promptTokens: today.totalPromptTokens,
          completionTokens: today.totalCompletionTokens,
          providers: Object.keys(today.byProvider).length,
          models: Object.keys(today.byModel).length,
        },
        successRate: today.totalRequests
          ? (today.totalRequests /
              (today.totalRequests +
                failures.filter(
                  (event) =>
                    Date.parse(event.timestamp) >= Date.now() - 86400000,
                ).length)) *
            100
          : null,
        recent,
      },
      health,
    };
  });
}

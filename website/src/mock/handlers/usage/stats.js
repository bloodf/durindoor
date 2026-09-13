// /api/usage/stats, /stream, /chart, /combos and /reset.
import { VALID_USAGE_STATS_PERIODS } from "@/lib/usagePeriods.js";
import { badRequest, reply, sse } from "../../http.js";
import { buildChart, buildComboReport, buildStats, customRange } from "./aggregate.js";
import { RESET_PERIODS, applyReset, tick } from "./live.js";

function periodFrom(searchParams, fallback) {
  const period = searchParams.get("period") || fallback;
  return VALID_USAGE_STATS_PERIODS.has(period) ? period : null;
}

export default function registerStats(router, { store }) {
  store.define("usage.reset", () => null);

  router.get("/api/usage/stats", ({ searchParams }) => {
    const period = periodFrom(searchParams, "7d");
    if (!period) return badRequest("Invalid period");
    return buildStats(store, period, { startDate: searchParams.get("startDate"), endDate: searchParams.get("endDate") });
  });

  // Full stats for the period, re-sent every few seconds as live traffic drifts.
  router.get("/api/usage/stream", ({ searchParams }) => {
    const period = periodFrom(searchParams, "today");
    if (!period) return badRequest("Invalid period");
    return sse({
      events: [buildStats(store, period)],
      next: () => {
        tick();
        return buildStats(store, period);
      },
      intervalMs: 3000,
    });
  });

  router.get("/api/usage/chart", ({ searchParams }) => {
    const period = periodFrom(searchParams, "7d");
    if (!period) return badRequest("Invalid period");
    return buildChart(store, period);
  });

  router.get("/api/usage/combos", ({ searchParams }) => {
    const period = periodFrom(searchParams, "7d");
    if (!period) return badRequest("Invalid period");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    if ((startDate || endDate) && !customRange(startDate, endDate)) return badRequest("Invalid date range");
    return buildComboReport(store, period, { startDate, endDate });
  });

  router.post("/api/usage/reset", ({ body }) => {
    const period = body?.period;
    if (!period || !RESET_PERIODS.includes(period)) {
      return reply({ error: `Invalid period. Must be one of: ${RESET_PERIODS.join(", ")}` }, { status: 400 });
    }
    applyReset(store, period);
    return { success: true, message: `Usage data for the last ${period} has been reset.` };
  });
}

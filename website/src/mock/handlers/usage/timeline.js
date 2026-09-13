// /api/timeline list + filters, /api/timeline/:id, /api/timeline/stream.
import { badRequest, notFound, sse } from "../../http.js";
import { LANES } from "../../fixtures/usageLanes.js";
import { laneWeightNow, makeRequestEvent, pickWeighted, usageHistory } from "../../fixtures/usageHistory.js";
import { fallbackFromEvent, publicTrace, seedTraces, traceEvents, traceFromEvent } from "../../fixtures/timelineTraces.js";

const COLLECTION = "usage.timeline";
const CAP = 400;
const FIELDS = { provider: "provider", model: "model", connectionId: "connection_id", apiKeyId: "api_key_id", status: "status", endpoint: "endpoint" };

function matches(trace, searchParams) {
  for (const [param, column] of Object.entries(FIELDS)) {
    const value = searchParams.get(param);
    if (value != null && trace[column] !== value) return false;
  }
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const q = searchParams.get("q");
  if (startDate != null && trace.started_at < startDate) return false;
  if (endDate != null && trace.started_at > endDate) return false;
  return q == null || trace.id.includes(q);
}

function sorted(store) {
  return [...store.list(COLLECTION)].sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
}

export default function registerTimeline(router, { store }) {
  store.define(COLLECTION, () => seedTraces(usageHistory().recent));

  router.get("/api/timeline", ({ searchParams }) => {
    const page = searchParams.get("page") === null ? 1 : Number(searchParams.get("page"));
    const pageSize = searchParams.get("pageSize") === null ? 20 : Number(searchParams.get("pageSize"));
    if (!Number.isInteger(page) || page < 1) return badRequest("page must be an integer >= 1");
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) return badRequest("pageSize must be an integer in [1,100]");
    const matching = sorted(store).filter((trace) => matches(trace, searchParams));
    const totalItems = matching.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    return {
      traces: matching.slice((page - 1) * pageSize, page * pageSize).map(publicTrace),
      pagination: { page, pageSize, totalItems, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
    };
  });

  router.delete("/api/timeline", () => {
    store.set(COLLECTION, []);
    return { ok: true };
  });

  router.get("/api/timeline/:id", ({ params }) => {
    const row = store.find(COLLECTION, params.id);
    if (!row) return notFound("Trace not found");
    return { trace: publicTrace(row), events: traceEvents(row) };
  });

  // Every few seconds a new request lands on the timeline; the page reloads on each message.
  router.get("/api/timeline/stream", ({ searchParams }) =>
    sse({
      intervalMs: 5000,
      next: () => {
        if (Math.random() < 0.35) return undefined;
        const lane = pickWeighted(Math.random, LANES, laneWeightNow);
        const event = makeRequestEvent(lane, Math.random, Date.now(), usageHistory().scales);
        const trace = event.httpStatus === 200 && Math.random() < 0.12 ? fallbackFromEvent(event) : traceFromEvent(event);
        store.set(COLLECTION, [trace, ...sorted(store)].slice(0, CAP));
        return matches(trace, searchParams) ? { type: "trace", id: trace.id } : undefined;
      },
    }),
  );
}

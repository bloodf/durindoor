import { getTrace, onTimelineWrite } from "@/lib/db/repos/proxyTimelineRepo.js";

export const dynamic = "force-dynamic";
/** Drop oldest live writes above this so a stalled lookup cannot grow forever. */
const LIVE_QUEUE_CAP = 1000;

const FILTER_KEYS = [
  "provider",
  "model",
  "connectionId",
  "apiKeyId",
  "status",
  "endpoint",
  "startDate",
  "endDate",
  "q",
];

function matchesFilters(trace, filters) {
  if (!trace) return false;
  if (filters.q && !String(trace.id || "").includes(filters.q)) return false;
  if (filters.provider != null && trace.provider !== filters.provider) return false;
  if (filters.model != null && trace.model !== filters.model) return false;
  if (filters.connectionId != null && trace.connection_id !== filters.connectionId) return false;
  if (filters.apiKeyId != null && trace.api_key_id !== filters.apiKeyId) return false;
  if (filters.status != null && trace.status !== filters.status) return false;
  if (filters.endpoint != null && trace.endpoint !== filters.endpoint) return false;
  if (filters.startDate != null && String(trace.started_at || "") < filters.startDate) return false;
  if (filters.endDate != null && String(trace.started_at || "") > filters.endDate) return false;
  return true;
}

/**
 * GET /api/timeline/stream — live SSE of sidecar writes.
 * Keepalive and abort cleanup copy the usage stream skeleton.
 * Filters match GET /api/timeline by looking up the parent trace.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const filters = {};
  for (const key of FILTER_KEYS) {
    const value = searchParams.get(key);
    if (value != null) filters[key] = value;
  }

  const encoder = new TextEncoder();
  const state = { closed: false, keepalive: null, unsubscribe: null, sending: false, queued: [] };

  const cleanup = () => {
    if (state.closed) return;
    state.closed = true;
    state.unsubscribe?.();
    if (state.keepalive) clearInterval(state.keepalive);
  };

  if (request.signal.aborted) cleanup();
  else request.signal.addEventListener("abort", cleanup, { once: true });

  const stream = new ReadableStream({
    start(controller) {
      const flush = async () => {
        if (state.sending) return;
        state.sending = true;
        try {
          while (!state.closed && state.queued.length) {
            const item = state.queued.shift();
            const id = item.id || item.traceId;
            const trace = id ? await getTrace(id) : null;
            if (state.closed || !matchesFilters(trace, filters)) continue;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(item)}\n\n`));
          }
        } catch {
          cleanup();
        } finally {
          state.sending = false;
          if (!state.closed && state.queued.length) flush();
        }
      };

      state.unsubscribe = onTimelineWrite((item) => {
        if (state.closed) return;
        if (state.queued.length >= LIVE_QUEUE_CAP) state.queued.shift();
        state.queued.push(item);
        flush();
      });

      if (state.closed) {
        controller.close();
        return;
      }

      state.keepalive = setInterval(() => {
        if (state.closed) { clearInterval(state.keepalive); return; }
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          cleanup();
        }
      }, 25000);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

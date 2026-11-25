import { statsEmitter, getUsageStats } from "@/lib/usageDb";
import { VALID_USAGE_STATS_PERIODS } from "@/lib/usagePeriods.js";
import { createStatsBroadcaster } from "@/lib/usage/statsBroadcaster.js";

export const dynamic = "force-dynamic";
// Bound aggregation work and listener counts per process. A missing credential
// shares one principal so anonymous callers cannot evade the per-key bound.
const MAX_PER_KEY = 4;
const MAX_TOTAL = 100;
const subscribers = new Map();
let total = 0;
// One computation per period, fanned out to every stream that asked for it.
const broadcaster = createStatsBroadcaster({ emitter: statsEmitter, compute: (period) => getUsageStats(period) });

/**
 * Streams full stats for the requested dashboard period (upstream #3388).
 * Invalid periods are rejected consistently with the REST stats endpoint.
 */

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period") || "today";
  if (!VALID_USAGE_STATS_PERIODS.has(period)) {
    return Response.json({ error: "Invalid period" }, { status: 400 });
  }

  const principal = request.headers?.get("authorization") || request.headers?.get("x-api-key") || "anonymous";
  if (total >= MAX_TOTAL || (subscribers.get(principal) || 0) >= MAX_PER_KEY) {
    return Response.json({ error: "Too many usage streams" }, { status: 429 });
  }
  total++;
  subscribers.set(principal, (subscribers.get(principal) || 0) + 1);

  const encoder = new TextEncoder();
  const state = { closed: false, keepalive: null, unsubscribe: null };

  const cleanup = () => {
    if (state.closed) return;
    state.closed = true;
    total--;
    const remaining = subscribers.get(principal) - 1;
    if (remaining) subscribers.set(principal, remaining);
    else subscribers.delete(principal);
    state.unsubscribe?.();
    if (state.keepalive) clearInterval(state.keepalive);
  };

  if (request.signal.aborted) cleanup();
  else request.signal.addEventListener("abort", cleanup, { once: true });

  const stream = new ReadableStream({
    async start(controller) {
      if (state.closed) {
        controller.close();
        return;
      }

      const push = (stats) => {
        if (state.closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(stats)}\n\n`));
        } catch {
          cleanup();
        }
      };
      state.unsubscribe = broadcaster.subscribe(period, { onStats: push, onError: cleanup });

      try {
        const stats = await broadcaster.snapshot(period);
        push(stats);
      } catch {
        cleanup();
      }
      if (state.closed) return;

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

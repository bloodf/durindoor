import { statsEmitter, getUsageStats } from "@/lib/usageDb";
import { VALID_USAGE_STATS_PERIODS } from "@/lib/usagePeriods.js";

export const dynamic = "force-dynamic";
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

  const encoder = new TextEncoder();
  const state = { closed: false, keepalive: null, send: null, sending: false, queued: false };

  const cleanup = () => {
    if (state.closed) return;
    state.closed = true;
    if (state.send) statsEmitter.off("update", state.send);
    if (state.send) statsEmitter.off("pending", state.send);
    if (state.keepalive) clearInterval(state.keepalive);
  };

  if (request.signal.aborted) cleanup();
  else request.signal.addEventListener("abort", cleanup, { once: true });

  const stream = new ReadableStream({
    async start(controller) {
      state.send = async () => {
        if (state.closed) return;
        if (state.sending) {
          state.queued = true;
          return;
        }

        state.sending = true;
        try {
          do {
            state.queued = false;
            // Full aggregation stays debounce-bounded by statsEmitter scheduling and this send/queue coalescer.
            const stats = await getUsageStats(period);
            if (state.closed) return;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(stats)}\n\n`));
          } while (!state.closed && state.queued);
        } catch {
          cleanup();
        } finally {
          state.sending = false;
        }
      };

      if (state.closed) {
        controller.close();
        return;
      }

      statsEmitter.on("update", state.send);
      statsEmitter.on("pending", state.send);

      await state.send();
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

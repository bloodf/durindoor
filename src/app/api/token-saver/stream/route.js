import { statsEmitter, getTokenSaverStats } from "@/lib/usageDb";
import { VALID_USAGE_STATS_PERIODS } from "@/lib/usagePeriods.js";

export const dynamic = "force-dynamic";

// Live Token Saver aggregate stream (port of decolua/9router #2562). Sends the
// period aggregate (incl. dailyPoints) on connect and on each "token-saver"
// event (emitted by recordTokenSaverEvent). Mirrors /api/usage/stream's
// abort-listener + sending/queued guard so rapid writes don't overlap DB reads
// or leak the listener.
export async function GET(request) {
  const period = new URL(request.url).searchParams.get("period") || "7d";
  if (!VALID_USAGE_STATS_PERIODS.has(period)) {
    return Response.json({ error: "Invalid period" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const state = { closed: false, keepalive: null, send: null, sending: false, queued: false };

  const cleanup = () => {
    if (state.closed) return;
    state.closed = true;
    if (state.send) statsEmitter.off("token-saver", state.send);
    clearInterval(state.keepalive);
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
            const stats = await getTokenSaverStats(period);
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

      statsEmitter.on("token-saver", state.send);

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

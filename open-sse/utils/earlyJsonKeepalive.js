/** Slow non-streaming JSON responses start with legal whitespace to prevent proxy idle timeouts.
 * Once the threshold passes the HTTP status is committed to 200, including for late errors.
 */
const encoder = new TextEncoder();
const space = encoder.encode(' ');
const fallback = encoder.encode(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'Upstream request failed.' } }));
export const DEFAULT_JSON_KEEPALIVE_THRESHOLD_MS = 60_000;

export function resolveJsonKeepaliveThresholdMs(env = process.env) {
  const raw = env.OMNIROUTE_NONSTREAM_KEEPALIVE_MS?.trim();
  return raw && /^\d{1,9}$/.test(raw) ? Number(raw) : DEFAULT_JSON_KEEPALIVE_THRESHOLD_MS;
}

export async function withEarlyJsonKeepalive(handlerPromise, { thresholdMs, intervalMs = 10_000, extraHeaders = {} }) {
  if (!(thresholdMs > 0)) return handlerPromise;
  const settled = handlerPromise.then(response => ({ response }), error => ({ error }));
  let timer;
  const result = await Promise.race([settled, new Promise(resolve => { timer = setTimeout(() => resolve(null), thresholdMs); })]);
  clearTimeout(timer);
  if (result) {
    if ('error' in result) throw result.error;
    return result.response;
  }
  let interval, reader, cancelled = false;
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(space);
      interval = setInterval(() => {
        try { controller.enqueue(space); } catch { clearInterval(interval); }
      }, Math.max(250, intervalMs));
      const outcome = await settled;
      clearInterval(interval);
      if (cancelled) {
        if (outcome.response?.body) outcome.response.body.cancel().catch(() => {});
        return;
      }
      let forwarded = false;
      try {
        if (outcome.response?.body) {
          reader = outcome.response.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value?.length) { controller.enqueue(value); forwarded = true; }
          }
        }
        if (!forwarded) controller.enqueue(fallback);
        controller.close();
      } catch {
        if (cancelled) return;
        if (forwarded) controller.error(new Error('upstream body failed'));
        else { controller.enqueue(fallback); controller.close(); }
      }
    },
    cancel() {
      cancelled = true;
      clearInterval(interval);
      reader?.cancel().catch(() => {});
    }
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no', ...extraHeaders } });
}

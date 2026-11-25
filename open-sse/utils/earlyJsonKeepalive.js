/** Opt-in keepalive for slow non-streaming JSON responses (ported from OmniRoute #21087).
 * Off by default. When enabled via DURINDOOR_NONSTREAM_KEEPALIVE_MS (or the
 * OmniRoute name OMNIROUTE_NONSTREAM_KEEPALIVE_MS), a response slower than the
 * threshold starts with legal JSON whitespace to prevent proxy idle timeouts.
 * Trade-off: past the threshold the HTTP status is committed to 200, so late
 * errors (429, 5xx) arrive as a 200 body and upstream headers such as
 * retry-after and request-id are dropped, breaking client retry semantics.
 * The early response retains the gateway's permissive CORS origin header.
 */
const encoder = new TextEncoder();
const space = encoder.encode(' ');
const fallback = encoder.encode(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'Upstream request failed.' } }));
// 0 = disabled. OmniRoute defaults to 60s; DurinDoor keeps real status codes by default.
export const DEFAULT_JSON_KEEPALIVE_THRESHOLD_MS = 0;
const THRESHOLD_ENV_NAMES = ['DURINDOOR_NONSTREAM_KEEPALIVE_MS', 'OMNIROUTE_NONSTREAM_KEEPALIVE_MS'];

/** First valid decimal value among the env names wins; invalid values fall through. */
export function resolveJsonKeepaliveThresholdMs(env = process.env) {
  for (const name of THRESHOLD_ENV_NAMES) {
    const raw = env[name]?.trim();
    if (raw && /^\d{1,9}$/.test(raw)) return Number(raw);
  }
  return DEFAULT_JSON_KEEPALIVE_THRESHOLD_MS;
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
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no', 'Access-Control-Allow-Origin': '*', ...extraHeaders } });
}

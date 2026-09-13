// Abortable streaming response for mocked completions. The shared textStream
// helper cannot see the request signal, so a Stop click would keep painting
// tokens; this one errors the body with an AbortError the moment the caller
// aborts, which is exactly what a real fetch stream does.

const MIN_MS = 25;
const MAX_MS = 40;

function abortError() {
  return new DOMException("The operation was aborted.", "AbortError");
}

export function streamFrames(frames, { signal, contentType = "text/event-stream", minMs = MIN_MS, maxMs = MAX_MS } = {}) {
  const encoder = new TextEncoder();
  let timer = null;
  let finished = false;
  let onAbort = null;

  const body = new ReadableStream({
    start(controller) {
      let index = 0;
      const stop = () => {
        finished = true;
        clearTimeout(timer);
        if (onAbort) signal?.removeEventListener?.("abort", onAbort);
      };
      onAbort = () => {
        if (finished) return;
        stop();
        try {
          controller.error(abortError());
        } catch {
          // Stream already closed by the reader.
        }
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener?.("abort", onAbort, { once: true });

      const tick = () => {
        if (finished) return;
        if (index >= frames.length) {
          stop();
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(frames[index]));
        index += 1;
        timer = setTimeout(tick, minMs + Math.random() * (maxMs - minMs));
      };
      timer = setTimeout(tick, minMs);
    },
    cancel() {
      finished = true;
      clearTimeout(timer);
      if (onAbort) signal?.removeEventListener?.("abort", onAbort);
    },
  });

  return new Response(body, {
    status: 200,
    headers: { "content-type": contentType, "cache-control": "no-cache", "x-request-id": `demo-${Date.now().toString(36)}` },
  });
}

/** Register the same handler under every public prefix (`/v1`, `/api/v1`). */
export function onBoth(router, method, path, handler) {
  router[method](`/v1${path}`, handler);
  router[method](`/api/v1${path}`, handler);
}

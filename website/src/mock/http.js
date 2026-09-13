// Response descriptors and helpers shared by every mock handler.
//
// A handler may return:
//   - a plain object / array            -> JSON 200
//   - reply(body, { status, headers })  -> JSON (or text) with a status
//   - sse({ events, next, intervalMs })  -> text/event-stream (fetch + EventSource)
//   - textStream(chunks, { ... })       -> chunked body (chat completions etc.)
//   - a native Response                 -> returned as-is

const MOCK = Symbol.for("durindoor.mock.descriptor");

export function reply(body, { status = 200, headers = {}, contentType = "application/json" } = {}) {
  return { [MOCK]: "reply", body, status, headers, contentType };
}

export function notFound(message = "Not found") {
  return reply({ error: message }, { status: 404 });
}

export function badRequest(message = "Bad request") {
  return reply({ error: message }, { status: 400 });
}

/**
 * Server-sent events. `events` are emitted first (spaced by `intervalMs`),
 * then `next()` is polled forever (every `intervalMs`) when provided.
 * Each event is either a payload (serialized as `data:`) or
 * `{ event, data }` for named events.
 */
export function sse({ events = [], next = null, intervalMs = 3000, firstDelayMs = 60 } = {}) {
  return { [MOCK]: "sse", events, next, intervalMs, firstDelayMs };
}

/** Chunked text body; each chunk is written after `intervalMs`. */
export function textStream(chunks, { intervalMs = 35, contentType = "text/event-stream", status = 200, headers = {} } = {}) {
  return { [MOCK]: "stream", chunks, intervalMs, contentType, status, headers };
}

export function isDescriptor(value, kind) {
  return Boolean(value && typeof value === "object" && value[MOCK] && (!kind || value[MOCK] === kind));
}

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function latency(min = 80, max = 250) {
  return wait(min + Math.floor(Math.random() * (max - min)));
}

export function encodeSseEvent(item) {
  if (item && typeof item === "object" && Object.hasOwn(item, "data") && Object.hasOwn(item, "event")) {
    const data = typeof item.data === "string" ? item.data : JSON.stringify(item.data);
    return `event: ${item.event}\ndata: ${data}\n\n`;
  }
  return `data: ${typeof item === "string" ? item : JSON.stringify(item)}\n\n`;
}

function streamFrom(produce, { contentType, status, headers }) {
  const encoder = new TextEncoder();
  let cancelled = false;
  const body = new ReadableStream({
    async start(controller) {
      try {
        await produce((text) => {
          if (!cancelled) controller.enqueue(encoder.encode(text));
          return !cancelled;
        });
      } catch (error) {
        console.debug("[demo] mock stream failed", error);
      }
      if (!cancelled) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  return new Response(body, { status, headers: { "content-type": contentType, "cache-control": "no-cache", ...headers } });
}

export function toResponse(result) {
  if (result instanceof Response) return result;
  if (isDescriptor(result, "reply")) {
    const text = result.contentType === "application/json" ? JSON.stringify(result.body ?? null) : String(result.body ?? "");
    return new Response(text, { status: result.status, headers: { "content-type": result.contentType, ...result.headers } });
  }
  if (isDescriptor(result, "stream")) {
    return streamFrom(async (write) => {
      for (const chunk of result.chunks) {
        await wait(result.intervalMs);
        if (!write(chunk)) return;
      }
    }, result);
  }
  if (isDescriptor(result, "sse")) {
    // A fetch()-consumed SSE response ends after the initial events so
    // readers awaiting `done` do not hang forever.
    return streamFrom(async (write) => {
      await wait(result.firstDelayMs);
      const events = result.events.length ? result.events : result.next ? [result.next()] : [];
      for (const event of events) {
        if (!write(encodeSseEvent(event))) return;
        await wait(20);
      }
    }, { contentType: "text/event-stream", status: 200, headers: {} });
  }
  return new Response(JSON.stringify(result ?? { success: true }), { status: 200, headers: { "content-type": "application/json" } });
}

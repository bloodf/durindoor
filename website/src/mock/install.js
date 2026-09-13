// Browser-only network boundary for the public demo. Patches fetch and
// EventSource once so every dashboard API call is answered from the in-memory
// store instead of a real server. Same-origin page/asset requests still reach
// Next.js; nothing ever reaches an external host.

import { createRouter } from "./router.js";
import { encodeSseEvent, isDescriptor, latency, reply, toResponse } from "./http.js";
import { store } from "./store.js";
import { registerAll } from "./handlers/index.js";

const INSTALLED = Symbol.for("durindoor.demo.network");
const API_PREFIXES = ["/api/", "/v1/", "/v1beta/"];

function isApiPath(pathname) {
  return pathname === "/api" || API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function toUrl(input) {
  if (input instanceof Request) return new URL(input.url);
  if (input instanceof URL) return input;
  return new URL(String(input), globalThis.location.origin);
}

async function readBody(input, init) {
  const raw = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined);
  if (raw == null) return undefined;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  if (raw instanceof FormData) return Object.fromEntries(raw.entries());
  if (raw instanceof URLSearchParams) return Object.fromEntries(raw.entries());
  return raw;
}

const warned = new Set();
function fallback(method, url) {
  const key = `${method} ${url.pathname}`;
  if (!warned.has(key)) {
    warned.add(key);
    console.debug(`[demo] no mock for ${key}; returning a generic success payload`);
  }
  return method === "GET" ? { success: true, data: [], items: [] } : { success: true };
}

export function installMockNetwork() {
  if (typeof window === "undefined" || globalThis[INSTALLED]) return globalThis[INSTALLED];

  const router = createRouter();
  const external = [];
  registerAll(router, { store, external: (test, handler) => external.push({ test, handler }) });

  async function dispatch(method, url, input, init) {
    const found = router.match(method, url.pathname);
    const context = {
      method,
      url,
      params: found?.params || {},
      query: Object.fromEntries(url.searchParams.entries()),
      searchParams: url.searchParams,
      body: method === "GET" || method === "HEAD" ? undefined : await readBody(input, init),
      signal: init?.signal || (input instanceof Request ? input.signal : undefined),
    };
    if (!found) return fallback(method, url);
    try {
      return await found.route.handler(context);
    } catch (error) {
      console.error(`[demo] mock handler failed for ${method} ${url.pathname}`, error);
      return reply({ error: "Demo handler failed" }, { status: 500 });
    }
  }

  const realFetch = globalThis.fetch.bind(globalThis);

  async function mockFetch(input, init) {
    const url = toUrl(input);
    const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    const sameOrigin = url.origin === globalThis.location.origin;

    if (sameOrigin && !isApiPath(url.pathname)) return realFetch(input, init);

    if (!sameOrigin) {
      const hit = external.find(({ test }) => test(url));
      await latency();
      const result = hit ? await hit.handler({ method, url, body: await readBody(input, init) }) : {};
      if (!hit) fallback(method, url);
      return toResponse(result);
    }

    const result = await dispatch(method, url, input, init);
    if (!isDescriptor(result, "sse") && !isDescriptor(result, "stream")) await latency();
    // Simulated latency makes aborts far more likely than against a local
    // server, and several dashboard effects abort without catching. An aborted
    // request simply never settles, so no stale update or unhandled rejection.
    if (isAborted(init, input)) return new Promise(() => {});
    return toResponse(result);
  }

  function isAborted(init, input) {
    const signal = init?.signal || (input instanceof Request ? input.signal : null);
    return Boolean(signal?.aborted);
  }

  class MockEventSource extends EventTarget {
    constructor(target, options = {}) {
      super();
      this.url = toUrl(target).href;
      this.withCredentials = Boolean(options.withCredentials);
      this.readyState = MockEventSource.CONNECTING;
      this.timers = new Set();
      for (const type of ["open", "message", "error"]) {
        let handler = null;
        const listener = (event) => handler?.call(this, event);
        Object.defineProperty(this, `on${type}`, {
          configurable: true,
          get: () => handler,
          set: (value) => {
            const next = typeof value === "function" ? value : null;
            if (handler && !next) this.removeEventListener(type, listener);
            if (!handler && next) this.addEventListener(type, listener);
            handler = next;
          },
        });
      }
      this.start();
    }

    later(fn, ms) {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        if (this.readyState !== MockEventSource.CLOSED) fn();
      }, ms);
      this.timers.add(timer);
    }

    emit(item) {
      const text = encodeSseEvent(item);
      const type = /^event: (.+)$/m.exec(text)?.[1] || "message";
      const data = /^data: (.*)$/m.exec(text)?.[1] ?? "";
      this.dispatchEvent(new MessageEvent(type, { data, origin: globalThis.location.origin }));
    }

    async start() {
      const url = new URL(this.url);
      const result = await dispatch("GET", url, this.url, undefined);
      if (this.readyState === MockEventSource.CLOSED) return;
      if (!isDescriptor(result, "sse")) {
        this.readyState = MockEventSource.CLOSED;
        this.dispatchEvent(new Event("error"));
        return;
      }
      this.later(() => {
        this.readyState = MockEventSource.OPEN;
        this.dispatchEvent(new Event("open"));
        let delay = 0;
        for (const item of result.events) {
          this.later(() => this.emit(item), delay);
          delay += 40;
        }
        if (typeof result.next === "function") {
          const tick = () => {
            const value = result.next();
            if (value !== undefined) this.emit(value);
            this.later(tick, result.intervalMs);
          };
          this.later(tick, result.events.length ? result.intervalMs : delay);
        }
      }, result.firstDelayMs);
    }

    close() {
      this.readyState = MockEventSource.CLOSED;
      this.timers.forEach((timer) => clearTimeout(timer));
      this.timers.clear();
    }
  }
  MockEventSource.CONNECTING = 0;
  MockEventSource.OPEN = 1;
  MockEventSource.CLOSED = 2;

  globalThis.fetch = mockFetch;
  globalThis.EventSource = MockEventSource;
  globalThis[INSTALLED] = { router, dispatch };
  return globalThis[INSTALLED];
}

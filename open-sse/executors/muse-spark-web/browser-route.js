// DurinDoor (MIT). Egress route and stage bounds for the Muse Spark Web token refresh (#2034).
import { createHash } from "node:crypto";
import { resolvePlaywrightProxy } from "../../services/browserPool.js";
import { resolveConnectProxyForRequest, resolveProxyForRequest } from "../../utils/proxyFetch.js";

export const META_AI_ORIGIN = "https://www.meta.ai";
const META_AI_HOME = `${META_AI_ORIGIN}/`;
const META_AI_GRAPHQL_API = `${META_AI_ORIGIN}/api/graphql`;

/**
 * Engines whose browser contexts are known to accept Playwright's per-context `proxy` option.
 * `chromium` is the plain Playwright launch in `browserPool.js`. Obscura (a CDP endpoint) and
 * cloakbrowser are not listed: this unit verified neither, so a proxied refresh on them is refused.
 * The claim for `chromium` rests on Playwright's documented contract and mocked tests only.
 */
export const PROXY_CAPABLE_ENGINES = Object.freeze(new Set(["chromium"]));

/** A refusal decided locally, before any send that carries the cookie, or after a stage bound. */
export class MuseBrowserRefusal extends Error {
  constructor(message) {
    super(message);
    this.name = "MuseBrowserRefusal";
  }
}

/**
 * Resolve the one egress route that both the bootstrap fetch and the browser context must use.
 *
 * Relays are refused whether or not they are strict: a browser cannot speak to an HTTP relay, and
 * the WebSocket leg refuses every relay too, so going direct would leave the chosen route. A strict
 * route with no proxy, an unsupported proxy scheme, an unparseable proxy URL, and a bootstrap URL
 * that would resolve differently from the page URL are refused as well. Nothing here sends traffic.
 *
 * @param {object|null|undefined} proxyOptions - the selected connection's proxy options
 * @returns {{source: "connection"|"env"|"direct", proxyUrl: string|null, routeId: string}}
 * @throws {MuseBrowserRefusal} with a message that never contains the proxy URL or credentials
 */
export function resolveMetaBrowserRoute(proxyOptions) {
  if (typeof proxyOptions?.vercelRelayUrl === "string" && proxyOptions.vercelRelayUrl.trim()) {
    throw new MuseBrowserRefusal("Meta AI browser refresh cannot use an HTTP relay; refusing before any send");
  }
  let route;
  let bootstrap;
  try {
    route = resolveConnectProxyForRequest(META_AI_HOME, proxyOptions);
    bootstrap = resolveProxyForRequest(META_AI_GRAPHQL_API, proxyOptions);
  } catch {
    throw new MuseBrowserRefusal("Meta AI browser refresh has no usable proxy route; refusing before any send");
  }
  if (bootstrap.source === "relay" || (bootstrap.proxyUrl || null) !== (route.proxyUrl || null)) {
    throw new MuseBrowserRefusal("Meta AI bootstrap and browser routes differ; refusing before any send");
  }
  if (route.proxyUrl) {
    let proxy;
    try {
      proxy = resolvePlaywrightProxy(route.proxyUrl);
    } catch {
      proxy = undefined;
    }
    if (!proxy) throw new MuseBrowserRefusal("Meta AI browser refresh cannot apply the selected proxy; refusing before any send");
  }
  const routeId = createHash("sha256").update(`${route.source}\0${route.proxyUrl || ""}`).digest("hex").slice(0, 16);
  return { source: route.source, proxyUrl: route.proxyUrl || null, routeId };
}

/**
 * Await `promise` until it settles, `signal` aborts, or `ms` passes. On abort or timeout the
 * returned promise rejects; `onLate` then runs with the value if `promise` resolves afterwards, so
 * a late browser context or page is closed instead of leaked. Its cleanup promise is pushed to
 * `cleanups` so the caller can hold its per-key lock until the cleanup ends.
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {{signal: AbortSignal, ms: number, label: string, cleanups: Promise<unknown>[], onLate?: (value: T) => unknown}} opts
 * @returns {Promise<T>}
 */
export function within(promise, { signal, ms, label, cleanups, onLate }) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      fn(value);
    };
    const giveUp = (error) => {
      if (done) return;
      // Only stages that can hand back a page or context register a cleanup. Other stages act on
      // a page that the caller closes itself, and may never settle.
      if (onLate) cleanups.push(promise.then((value) => onLate(value), () => {}).catch(() => {}));
      else promise.catch(() => {});
      finish(reject, error);
    };
    const onAbort = () => giveUp(new MuseBrowserRefusal(`Meta AI browser refresh aborted during ${label}`));
    const timer = setTimeout(() => giveUp(new MuseBrowserRefusal(`Meta AI browser refresh timed out during ${label}`)), ms);
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then((value) => finish(resolve, value), (error) => finish(reject, error));
  });
}

const LOCKS = new Map();

/**
 * Run `fn` alone for `key`. Callers for the same credential, connection and route queue, so one
 * request cannot close the pooled context another is still using. A waiter stops waiting when its
 * own signal aborts. The lock is held until every late cleanup that `fn` registered has settled,
 * or for at most `waitMs` more, so a launch that never settles cannot block the key for ever.
 *
 * @template T
 * @param {string} key
 * @param {AbortSignal} signal
 * @param {(cleanups: Promise<unknown>[]) => Promise<T>} fn
 * @param {number} waitMs
 * @returns {Promise<T>}
 */
export async function withKeyLock(key, signal, fn, waitMs) {
  const previous = LOCKS.get(key) || Promise.resolve();
  let unlock;
  const mine = new Promise((resolve) => { unlock = resolve; });
  const tail = previous.then(() => mine);
  LOCKS.set(key, tail);
  const cleanups = [];
  try {
    await within(previous, { signal, ms: waitMs, label: "queue", cleanups: [] });
    return await fn(cleanups);
  } finally {
    let cap;
    const capped = new Promise((resolve) => { cap = setTimeout(resolve, waitMs); cap.unref?.(); });
    Promise.race([Promise.allSettled(cleanups), capped]).then(() => {
      clearTimeout(cap);
      unlock();
      if (LOCKS.get(key) === tail) LOCKS.delete(key);
    });
  }
}

/** Test-only: number of keys with a queued or running refresh. */
export function __museRefreshLockCountForTesting() {
  return LOCKS.size;
}

import { isFunction, isObject, isString } from "../src/shared/utils/typeChecks.js";

const JSON_HEADERS = { "content-type": "application/json" };
const SSE_HEADERS = { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" };

// Live overlay produced by /api/usage/stream — see src/lib/db/repos/usageRepo.js
// getUsageStats(). activeRequests/activeSessions are ARRAYS, pending is the
// { byModel, byAccount, byKey } structure, and the top-level stats payload
// carries totalRequests, totals, byModel/byAccount/byProvider/byApiKey/byEndpoint,
// last10Minutes — UsageStats iterates those via mergeUsageResponse().
const MODEL_RAW = "gpt-4o";
const PROVIDER_RAW = "openai";
const MODEL_STATS_KEY = `${MODEL_RAW} (${PROVIDER_RAW})`;
const ACCOUNT_CONNECTION_ID = "fixture-conn-1";
const ACCOUNT_NAME = "Fixture Account";
const ACCOUNT_DISPLAY_NAME = "Fixture Provider";
const ACCOUNT_STATS_KEY = `${MODEL_RAW} (${PROVIDER_RAW} - ${ACCOUNT_NAME})`;

const MODEL_ROW = {
  requests: 3,
  promptTokens: 120,
  completionTokens: 80,
  cachedTokens: 0,
  reasoningTokens: 0,
  cacheCreationTokens: 0,
  cost: 0.0012,
  rawModel: MODEL_RAW,
  provider: ACCOUNT_DISPLAY_NAME,
  rawProvider: PROVIDER_RAW,
  lastUsed: "2026-09-05",
};

const ACCOUNT_ROW = {
  ...MODEL_ROW,
  connectionId: ACCOUNT_CONNECTION_ID,
  accountName: ACCOUNT_NAME,
};

const PROVIDER_ROW = {
  requests: 3,
  promptTokens: 120,
  completionTokens: 80,
  cachedTokens: 0,
  reasoningTokens: 0,
  cacheCreationTokens: 0,
  cost: 0.0012,
};

// Production-shaped stats payload with one model + one account row + a
// coherent pending map so UsageStats's sortData and account-case pending
// lookup both run. Empty payloads regress the render path; this one
// exercises both branches.
function makeUsageStats() {
  return {
    totalRequests: 3,
    totalPromptTokens: 120,
    totalCompletionTokens: 80,
    totalCachedTokens: 0,
    totalReasoningTokens: 0,
    totalCacheCreationTokens: 0,
    totalCost: 0.0012,
    byProvider: { [PROVIDER_RAW]: { ...PROVIDER_ROW } },
    byModel: { [MODEL_STATS_KEY]: { ...MODEL_ROW } },
    byAccount: { [ACCOUNT_STATS_KEY]: { ...ACCOUNT_ROW } },
    byApiKey: {},
    byEndpoint: {},
    last10Minutes: [
      { requests: 3, promptTokens: 120, completionTokens: 80, cost: 0.0012 },
    ],
    pending: {
      byModel: { [MODEL_STATS_KEY]: 1 },
      byAccount: { [ACCOUNT_CONNECTION_ID]: { [MODEL_STATS_KEY]: 1 } },
      byKey: {},
    },
    activeRequests: [
      { model: MODEL_RAW, provider: PROVIDER_RAW, account: ACCOUNT_NAME, count: 1, keys: [] },
    ],
    activeSessions: [],
    recentRequests: [
      { timestamp: "2026-09-05T00:00:00.000Z", model: MODEL_RAW, provider: PROVIDER_RAW, promptTokens: 120, completionTokens: 80, cachedTokens: 0, status: "ok" },
    ],
    errorProvider: "",
  };
}

function makeEmptyUsageStats() {
  return {
    totalRequests: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalCachedTokens: 0,
    totalReasoningTokens: 0,
    totalCacheCreationTokens: 0,
    totalCost: 0,
    byProvider: {},
    byModel: {},
    byAccount: {},
    byApiKey: {},
    byEndpoint: {},
    last10Minutes: [],
    pending: { byModel: {}, byAccount: {}, byKey: {} },
    activeRequests: [],
    activeSessions: [],
    recentRequests: [],
    errorProvider: "",
  };
}

// UsageChart fetches /api/usage/chart — see src/app/(dashboard)/dashboard/usage/components/UsageChart.js.
// getChartData returns an array of { date, tokens, cost } buckets.
const USAGE_CHART_ROW = { date: "2026-09-05", tokens: 200, cost: 0.0012 };
const USAGE_CHART = [USAGE_CHART_ROW];
const USAGE_CHART_EMPTY = [];

// /api/keys returns providerConnections as an array of {id, name, provider}.
const KEYS_BASE = { keys: [], providerConnections: [] };

const SCENARIOS = {
  default: {
    "GET /api/providers": { body: { connections: [] } },
    "GET /api/provider-nodes": { body: { nodes: [] } },
    "GET /api/keys": { body: { ...KEYS_BASE } },
    "GET /api/settings": { body: { theme: "dark", disabledFreeProviders: [] } },
    "GET /api/models/alias": { body: { aliases: {} } },
    "GET /api/usage/stats": { body: makeUsageStats() },
    "GET /api/usage/stream": { events: [makeUsageStats()] },
    "GET /api/usage/chart": { body: [...USAGE_CHART] },
  },
  providers: {
    "GET /api/providers": { body: { connections: [{ id: "fixture-provider", name: "Fixture Provider", provider: "fixture", isActive: true, createdAt: 0 }] } },
    "GET /api/provider-nodes": { body: { nodes: [{ id: "fixture", name: "Fixture Node" }] } },
    "GET /api/keys": { body: { keys: [{ id: "fixture-key", name: "Fixture key", maskedKey: "••••fixture" }], providerConnections: [] } },
    "GET /api/settings": { body: { theme: "dark", disabledFreeProviders: [] } },
    "GET /api/models/alias": { body: { aliases: { "fixture-model": "Fixture Model" } } },
    "GET /api/usage/stats": { body: makeUsageStats() },
    "GET /api/usage/stream": { events: [makeUsageStats()] },
    "GET /api/usage/chart": { body: [...USAGE_CHART] },
  },
  empty: {
    "GET /api/providers": { body: { connections: [] } },
    "GET /api/provider-nodes": { body: { nodes: [] } },
    "GET /api/keys": { body: { ...KEYS_BASE } },
    "GET /api/settings": { body: { theme: "dark", disabledFreeProviders: [] } },
    "GET /api/models/alias": { body: { aliases: {} } },
    "GET /api/usage/stats": { body: makeEmptyUsageStats() },
    "GET /api/usage/stream": { events: [makeEmptyUsageStats()] },
    "GET /api/usage/chart": { body: [...USAGE_CHART_EMPTY] },
  },
  error: {
    "GET /api/providers": { body: { error: "Fixture provider request failed" }, status: 503 },
    "GET /api/provider-nodes": { body: { error: "Fixture provider-nodes request failed" }, status: 503 },
    "GET /api/keys": { body: { error: "Fixture key request failed" }, status: 503 },
  },
  // `actualUsageStats` mirrors the named production routes UsageStats hits,
  // with the production-shaped payload so render exercises the model +
  // account branches with a coherent pending map. Stories that mount the
  // actual UsageStats component should pass this scenario.
  actualUsageStats: {
    "GET /api/providers": { body: { connections: [] } },
    "GET /api/provider-nodes": { body: { nodes: [] } },
    "GET /api/keys": { body: { ...KEYS_BASE } },
    "GET /api/settings": { body: { theme: "dark", disabledFreeProviders: [] } },
    "GET /api/models/alias": { body: { aliases: {} } },
    "GET /api/usage/stats": { body: makeUsageStats() },
    "GET /api/usage/stream": { events: [makeUsageStats()] },
    "GET /api/usage/chart": { body: [...USAGE_CHART] },
  },
  "usage-stream": {
    "GET /api/providers": { body: { connections: [] } },
    "GET /api/provider-nodes": { body: { nodes: [] } },
    "GET /api/keys": { body: { ...KEYS_BASE } },
    "GET /api/settings": { body: { theme: "dark", disabledFreeProviders: [] } },
    "GET /api/models/alias": { body: { aliases: {} } },
    "GET /api/usage/stats": { body: makeEmptyUsageStats() },
    "GET /api/usage/stream": { events: [makeEmptyUsageStats()] },
    "GET /api/usage/chart": { body: [...USAGE_CHART_EMPTY] },
  },
};

function response(value, status = 200, contentType = "application/json") {
  const body = contentType === "application/json" ? JSON.stringify(value) : value;
  return new Response(body, { status, headers: { "content-type": contentType } });
}

function sseResponse(events) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`data: ${isString(event) ? event : JSON.stringify(event)}\n\n`));
      controller.close();
    },
  }), { headers: SSE_HEADERS });
}

function requestUrl(input) {
  if (input instanceof Request) return new URL(input.url);
  return new URL(String(input), globalThis.location?.origin || "http://storybook.local");
}

function requestMethod(input, init) {
  return (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
}

function isPlainObject(value) {
  if (!value || !isObject(value) || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
// Descriptor fixtures receive native fetch override/body semantics.
function descriptorRequest(input, init) {
  const request = new Request(input instanceof Request ? input.clone() : requestUrl(input).href, init);
  Object.defineProperty(request, "pathname", { value: new URL(request.url).pathname });
  return request;
}

// Resolves a route entry to a { body, status?, events?, contentType? }
// descriptor. Route values may be that descriptor directly, or a function of
// the native request that returns one. Function descriptors are fetch-only.
function validFixture(result) {
  return isPlainObject(result)
    && (Object.hasOwn(result, "body") || Object.hasOwn(result, "events"))
    && (!Object.hasOwn(result, "events") || Array.isArray(result.events))
    && (!Object.hasOwn(result, "status") || (Number.isInteger(result.status) && result.status >= 200 && result.status <= 599))
    && (!Object.hasOwn(result, "contentType") || isString(result.contentType));
}

function requireFixture(result) {
  if (!validFixture(result)) throw new Error("Storybook fixture descriptor must return a plain { body, status?, events?, contentType? } object");
  return result;
}

async function resolveFixture(entry, input, init) {
  return requireFixture(isFunction(entry) ? await entry(descriptorRequest(input, init)) : entry);
}

function isLocalAsset(url) {
  return url.origin === globalThis.location?.origin
    && !url.pathname.startsWith("/api/")
    && (/^\/(?:assets|fonts|_next)\//.test(url.pathname) || /\.(?:css|js|mjs|map|woff2?|ttf|otf|svg|png|jpe?g|gif|webp|ico)$/i.test(url.pathname));
}

/**
 * Installs one strict, scenario-specific fetch/EventSource boundary. It never
 * reaches an API host: unknown API and external requests reject immediately.
 * Optional `routes` are merged over the chosen scenario. `externalFixtures`
 * maps exact `METHOD https://full-url` keys to in-memory descriptors; unknown
 * external URLs never pass through.
 */
export function installStoryNetwork({
  scenario = "default",
  routes: routeOverrides = null,
  externalFixtures = null,
} = {}) {
  const base = SCENARIOS[scenario];
  if (!base) throw new Error(`Unknown Storybook fixture scenario: ${scenario}`);
  if (routeOverrides !== null && !isPlainObject(routeOverrides)) throw new Error("Storybook fixture routes must be a plain object");
  if (externalFixtures !== null && !isPlainObject(externalFixtures)) throw new Error("Storybook externalFixtures must be a plain object");
  const routes = { ...base, ...(routeOverrides || {}) };
  const external = externalFixtures || {};

  const originalFetch = globalThis.fetch;
  const OriginalEventSource = globalThis.EventSource;
  const sources = new Set();
  const timers = new Set();
  let active = true;

  async function lookup(input, init, url, method) {
    const key = `${method} ${url.pathname}`;
    if (url.origin === globalThis.location?.origin) {
      const entry = routes[`${key}${url.search}`] ?? routes[key];
      return entry == null ? null : resolveFixture(entry, input, init);
    }
    const entry = external[`${method} ${url.href}`];
    return entry == null ? null : resolveFixture(entry, input, init);
  }

  globalThis.fetch = async (input, init) => {
    if (!active) throw new Error("Storybook fixture network has been cleaned up");
    const url = requestUrl(input);
    const method = requestMethod(input, init);
    const fixture = await lookup(input, init, url, method);
    if (fixture) return fixture.events ? sseResponse(fixture.events) : response(fixture.body, fixture.status, fixture.contentType);
    if (url.origin === globalThis.location?.origin && isLocalAsset(url) && originalFetch) return originalFetch(input, init);
    throw new Error(`Unexpected Storybook network request: ${method} ${url.href}`);
  };

  class FixtureEventSource extends EventTarget {
    constructor(url) {
      super();
      const parsed = requestUrl(url);
      if (parsed.origin !== globalThis.location?.origin) throw new Error(`Unexpected Storybook EventSource request: ${parsed.href}`);
      const key = `GET ${parsed.pathname}`;
      const entry = routes[`${key}${parsed.search}`] ?? routes[key];
      if (!active || entry == null || isFunction(entry)) throw new Error(`Unexpected Storybook EventSource request: ${parsed.href}`);
      const fixture = requireFixture(entry);
      if (!fixture.events) throw new Error(`Unexpected Storybook EventSource request: ${parsed.href}`);
      this.url = parsed.href;
      this.readyState = FixtureEventSource.CONNECTING;
      this.withCredentials = false;
      // EventTarget does not implement browser EventHandler attributes.
      // A stable listener preserves registration order when a handler changes.
      for (const type of ["open", "message", "error"]) {
        let handler = null;
        const listener = (event) => handler?.call(this, event);
        Object.defineProperty(this, `on${type}`, {
          configurable: true,
          get: () => handler,
          set: (value) => {
            const next = isFunction(value) ? value : null;
            if (handler && !next) this.removeEventListener(type, listener);
            if (!handler && next) this.addEventListener(type, listener);
            handler = next;
          },
        });
      }
      sources.add(this);
      this.schedule(() => {
        this.readyState = FixtureEventSource.OPEN;
        this.emit("open", new Event("open"));
        fixture.events.forEach((data, index) => this.schedule(() => this.emit("message", new MessageEvent("message", { data: isString(data) ? data : JSON.stringify(data), lastEventId: String(index) }))));
      });
    }

    schedule(callback) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (active && this.readyState !== FixtureEventSource.CLOSED) callback();
      }, 0);
      timers.add(timer);
    }

    emit(type, event) {
      this.dispatchEvent(event);
    }

    close() {
      this.readyState = FixtureEventSource.CLOSED;
      sources.delete(this);
    }
  }
  FixtureEventSource.CONNECTING = 0;
  FixtureEventSource.OPEN = 1;
  FixtureEventSource.CLOSED = 2;
  globalThis.EventSource = FixtureEventSource;

  return async function cleanupStoryNetwork() {
    if (!active) return;
    active = false;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    for (const source of sources) source.close();
    sources.clear();
    globalThis.fetch = originalFetch;
    globalThis.EventSource = OriginalEventSource;
  };
}

export const STORY_FIXTURE_SCENARIOS = Object.freeze(Object.keys(SCENARIOS));
export const STORY_FIXTURE_USAGE_STATS = Object.freeze(makeUsageStats());
export const STORY_FIXTURE_USAGE_STATS_EMPTY = Object.freeze(makeEmptyUsageStats());
export const STORY_FIXTURE_USAGE_CHART = Object.freeze(USAGE_CHART);
export const STORY_FIXTURE_USAGE_MODEL = MODEL_RAW;
export const STORY_FIXTURE_USAGE_MODEL_STATS_KEY = MODEL_STATS_KEY;
export const STORY_FIXTURE_USAGE_ACCOUNT_NAME = ACCOUNT_NAME;
export const STORY_FIXTURE_USAGE_ACCOUNT_STATS_KEY = ACCOUNT_STATS_KEY;
export const STORY_FIXTURE_USAGE_PROVIDER_DISPLAY = ACCOUNT_DISPLAY_NAME;

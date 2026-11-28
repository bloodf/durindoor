// @vitest-environment happy-dom
/**
 * #2627: a browser probe that is still in flight when its endpoint is
 * disabled, re-enabled, or moved to another URL must not record its result.
 * Before the fix, such a probe completed after the disabled-state reset and
 * restored stale reachability. Probes are held as deferred promises and the
 * real endpoint page runs under fake timers, so each test controls exactly
 * when a stale probe completes relative to the status poll.
 */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLIENT_PING_SLOW_MS,
  REACHABLE_MISS_THRESHOLD,
  STATUS_POLL_SLOW_MS,
} from "../../src/app/(dashboard)/dashboard/endpoint/endpointConstants.js";

const server = vi.hoisted(() => ({ status: null }));
vi.mock("@/store/settingsStore", () => ({
  default: { getState: () => ({ fetchSettings: async () => ({ requireApiKey: false, requireLogin: true, hasPassword: true }) }) },
}));
vi.mock("@/shared/utils/api", () => ({
  get: vi.fn(async (url) => {
    if (url !== "/api/tunnel/status") throw new Error(`unexpected ${url}`);
    return server.status;
  }),
}));
vi.mock("../../src/app/(dashboard)/dashboard/providers/workflowRequests.js", () => ({
  requestJSON: async () => server.status,
}));
vi.mock("../../src/app/(dashboard)/dashboard/endpoint/components/MonitoringStrip", () => ({ default: () => null }));
vi.mock("@/shared/ui/v5/production/uiVersion.js", () => ({ useUiV5: () => false }));

const { default: EndpointPageClient } = await import("../../src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.jsx");

const CF = "https://cf.example";
const CF_NEW = "https://cf-new.example";
const TS = "https://ts.example";
const TS_NEW = "https://ts-new.example";

/**
 * `self` describes the endpoint under test, `other` the second provider.
 * The other provider can stay enabled so the status poll keeps running
 * while the endpoint under test is disabled.
 */
const ENDPOINTS = [
  {
    name: "Cloudflare",
    url: CF,
    newUrl: CF_NEW,
    otherUrl: TS,
    status: ({ enabled, url = CF, other = false }) => ({
      tunnel: { enabled, tunnelUrl: url, publicUrl: "" },
      tailscale: { enabled: other, tunnelUrl: TS },
    }),
    disableLabel: "Disable Cloudflare tunnel",
    disableRoute: "/api/tunnel/disable",
    checking: "Tunnel checking...",
    reconnecting: "Tunnel reconnecting...",
  },
  {
    name: "Tailscale",
    url: TS,
    newUrl: TS_NEW,
    otherUrl: CF,
    status: ({ enabled, url = TS, other = false }) => ({
      tunnel: { enabled: other, tunnelUrl: CF, publicUrl: "" },
      tailscale: { enabled, tunnelUrl: url },
    }),
    disableLabel: "Disable Tailscale",
    disableRoute: "/api/tunnel/tailscale-disable",
    checking: "Tailscale checking...",
    reconnecting: "Tailscale reconnecting...",
  },
];

let host, root, down, hold, held;
beforeEach(() => {
  vi.useFakeTimers();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  down = new Set();
  hold = new Set();
  held = [];
  vi.stubGlobal("fetch", vi.fn((url) => {
    if (!String(url).endsWith("/api/health")) return Promise.reject(new Error(`unexpected fetch ${url}`));
    const origin = new URL(url).origin;
    // While an origin is held, every probe to it stays in flight until the test settles it.
    // The page re-probes on each reachability change, so a one-shot hold would let later probes through.
    if (hold.has(origin)) {
      return new Promise((resolve) => held.push({ origin, pass: () => resolve({ ok: true }), fail: () => resolve({ ok: false }) }));
    }
    return Promise.resolve({ ok: !down.has(origin) });
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const advance = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const settle = (fn) => act(async () => { fn(); await vi.advanceTimersByTimeAsync(0); });
const reachableAt = (url) => host.textContent.includes(`${url}/v1`);
/** Returns the probes held for an origin, oldest first, and stops holding new ones. */
const release = (origin) => {
  hold.delete(origin);
  const probes = held.filter((probe) => probe.origin === origin);
  expect(probes.length, `a probe to ${origin} is in flight`).toBeGreaterThan(0);
  return probes;
};

async function mount(status) {
  server.status = status;
  act(() => root.render(React.createElement(EndpointPageClient)));
  await advance(0);
}

describe.each(ENDPOINTS)("$name stale in-flight probe (#2627)", (endpoint) => {
  it("drops a passing probe that completes after the disable reset, then re-enable starts unreachable", async () => {
    // The endpoint has never passed: its first probe is held in flight.
    hold.add(endpoint.url);
    await mount(endpoint.status({ enabled: true, other: true }));
    expect(reachableAt(endpoint.url)).toBe(false);

    // The status poll sees the endpoint disabled and resets its reachability.
    server.status = endpoint.status({ enabled: false, other: true });
    await advance(STATUS_POLL_SLOW_MS);
    expect(host.textContent).not.toContain(endpoint.checking);

    // A probe started before the disable now passes. It must not count.
    const [stale] = release(endpoint.url);
    await settle(stale.pass);

    // Re-enabled while the endpoint does not answer yet: a stale pass would show it reachable.
    down.add(endpoint.url);
    server.status = endpoint.status({ enabled: true, other: true });
    await advance(STATUS_POLL_SLOW_MS);
    expect(reachableAt(endpoint.url)).toBe(false);
    expect(host.textContent).toContain(endpoint.checking);
  });

  it("drops a passing probe that completes after the endpoint was re-enabled", async () => {
    hold.add(endpoint.url);
    await mount(endpoint.status({ enabled: true, other: true }));

    server.status = endpoint.status({ enabled: false, other: true });
    await advance(STATUS_POLL_SLOW_MS);
    const [stale] = release(endpoint.url);
    down.add(endpoint.url);
    server.status = endpoint.status({ enabled: true, other: true });
    await advance(STATUS_POLL_SLOW_MS);
    expect(reachableAt(endpoint.url)).toBe(false);

    // The pre-disable probe lands after the re-enable and its fresh failing probe.
    await settle(stale.pass);
    expect(reachableAt(endpoint.url)).toBe(false);
    expect(host.textContent).toContain(endpoint.checking);
  });

  it("drops a stale result after a disable through the page's own disable action", async () => {
    await mount(endpoint.status({ enabled: true, other: true }));
    expect(reachableAt(endpoint.url)).toBe(true);

    // A probe to the still-enabled endpoint is in flight when the user disables it.
    hold.add(endpoint.url);
    await advance(STATUS_POLL_SLOW_MS * 2);
    const probeFetch = globalThis.fetch;
    globalThis.fetch = vi.fn((url, init) => (url === endpoint.disableRoute
      ? Promise.resolve({ ok: true, json: async () => ({}) })
      : probeFetch(url, init)));
    const disableButton = host.querySelector(`button[aria-label="${endpoint.disableLabel}"]`);
    expect(disableButton, "endpoint row offers a disable action").toBeTruthy();
    await settle(() => disableButton.click());
    const confirm = [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Disable");
    expect(confirm, "disable is confirmed in a modal").toBeTruthy();
    await settle(() => confirm.click());
    expect(globalThis.fetch).toHaveBeenCalledWith(endpoint.disableRoute, expect.anything());
    expect(host.textContent).not.toContain(endpoint.checking);

    const [stale] = release(endpoint.url);
    await settle(stale.pass);
    down.add(endpoint.url);
    server.status = endpoint.status({ enabled: true, other: true });
    await advance(STATUS_POLL_SLOW_MS);
    // It passed before, so the row reads "reconnecting" rather than showing the URL.
    expect(reachableAt(endpoint.url)).toBe(false);
    expect(host.textContent).toContain(endpoint.reconnecting);
  });

  it("drops a probe of the old URL after the endpoint moves to a new URL", async () => {
    hold.add(endpoint.url);
    await mount(endpoint.status({ enabled: true, other: true }));

    // The endpoint moves to a URL that does not answer yet.
    down.add(endpoint.newUrl);
    server.status = endpoint.status({ enabled: true, url: endpoint.newUrl, other: true });
    await advance(STATUS_POLL_SLOW_MS);
    expect(reachableAt(endpoint.newUrl)).toBe(false);

    // The old URL's probe passes, but it says nothing about the new URL.
    const [stale] = release(endpoint.url);
    await settle(stale.pass);
    expect(reachableAt(endpoint.newUrl)).toBe(false);
    expect(host.textContent).toContain(endpoint.checking);
  });

  it("keeps an in-flight probe whose target did not change when the other provider reruns the probe effect", async () => {
    // Only this endpoint is enabled, and its first probe is held in flight.
    hold.add(endpoint.url);
    down.add(endpoint.url);
    await mount(endpoint.status({ enabled: true, other: false }));
    const [current] = release(endpoint.url);

    // The other provider turns on: the probe effect reruns and probes this
    // endpoint again (down), while the first probe is still in flight.
    server.status = endpoint.status({ enabled: true, other: true });
    await advance(STATUS_POLL_SLOW_MS);
    expect(host.textContent).toContain(endpoint.checking);

    // The first probe targets the same URL and enabled state, so it still counts.
    await settle(current.pass);
    expect(reachableAt(endpoint.url)).toBe(true);
  });

  it("keeps the miss threshold: stale failures do not count toward a new URL's streak", async () => {
    await mount(endpoint.status({ enabled: true, other: true }));
    expect(reachableAt(endpoint.url)).toBe(true);

    // Hold REACHABLE_MISS_THRESHOLD probes to the old URL; they will fail late.
    hold.add(endpoint.url);
    await advance(CLIENT_PING_SLOW_MS * REACHABLE_MISS_THRESHOLD);
    expect(reachableAt(endpoint.url)).toBe(true);

    // The endpoint moves to a healthy URL, which passes immediately.
    server.status = endpoint.status({ enabled: true, url: endpoint.newUrl, other: true });
    await advance(STATUS_POLL_SLOW_MS);
    expect(reachableAt(endpoint.newUrl)).toBe(true);
    const stale = release(endpoint.url);
    expect(stale.length).toBeGreaterThanOrEqual(REACHABLE_MISS_THRESHOLD);

    // The new URL stops answering. A flip re-probes at once, and that probe
    // now fails, so a wrongly counted miss streak would keep it unreachable.
    down.add(endpoint.newUrl);

    // Every stale failure lands: without the fix they reach the threshold and flip it.
    for (const probe of stale) await settle(probe.fail);
    expect(reachableAt(endpoint.newUrl)).toBe(true);

    // The new URL's own misses still need the full threshold to flip it.
    for (let miss = 1; miss < REACHABLE_MISS_THRESHOLD; miss++) {
      await advance(CLIENT_PING_SLOW_MS);
      expect(reachableAt(endpoint.newUrl)).toBe(true);
    }
    await advance(CLIENT_PING_SLOW_MS);
    expect(reachableAt(endpoint.newUrl)).toBe(false);
  });
});

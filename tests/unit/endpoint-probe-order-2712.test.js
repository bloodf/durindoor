// @vitest-environment happy-dom
/** #2712: retire Tailscale probes queued behind an in-flight Cloudflare request. */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
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
const TS = "https://ts.example";
const TS_NEW = "https://ts-new.example";

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
async function mount(status) {
  server.status = status;
  act(() => root.render(React.createElement(EndpointPageClient)));
  await advance(0);
}

const status = (enabled = true, url = TS) => ({
  tunnel: { enabled: true, tunnelUrl: CF, publicUrl: "" },
  tailscale: { enabled, tunnelUrl: url },
});

describe("Tailscale probe queued behind Cloudflare (#2712)", () => {
  it.each(["disable", "URL change"])("retires the queued old target after a %s", async (change) => {
    // Both endpoints are enabled, but Cloudflare prevents Tailscale from starting.
    hold.add(CF);
    await mount(status());
    expect(held.length).toBeGreaterThan(0);
    expect(fetch.mock.calls.some(([url]) => String(url).startsWith(TS))).toBe(false);

    down.add(TS_NEW);
    server.status = change === "disable" ? status(false) : status(true, TS_NEW);
    await advance(STATUS_POLL_SLOW_MS);
    const queued = [...held];
    hold.delete(CF);
    await settle(() => queued.forEach((probe) => probe.pass()));

    // Retired callbacks must neither dispatch to the old URL nor record its pass
    // as reachability for a disabled endpoint or the replacement URL.
    expect(fetch.mock.calls.some(([url]) => new URL(url).origin === TS)).toBe(false);
    expect(reachableAt(TS)).toBe(false);
    expect(reachableAt(TS_NEW)).toBe(false);
    if (change === "disable") {
      down.add(TS);
      server.status = status();
      await advance(STATUS_POLL_SLOW_MS);
    }
    expect(host.textContent).toContain("Tailscale checking...");
  });
});

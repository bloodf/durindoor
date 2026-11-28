// @vitest-environment happy-dom
/**
 * #2620: endpoint reachability is driven by completed browser probes only.
 * Renders the real endpoint page under fake timers, so the status poll
 * (STATUS_POLL_*) and the client probe (CLIENT_PING_*) intervals both run.
 */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLIENT_PING_FAST_MS,
  CLIENT_PING_SLOW_MS,
  REACHABLE_MISS_THRESHOLD,
  STATUS_POLL_SLOW_MS,
} from "../../src/app/(dashboard)/dashboard/endpoint/endpointConstants.js";

const server = vi.hoisted(() => ({ status: null, statusReads: 0 }));
vi.mock("@/store/settingsStore", () => ({
  default: { getState: () => ({ fetchSettings: async () => ({ requireApiKey: false, requireLogin: true, hasPassword: true }) }) },
}));
vi.mock("@/shared/utils/api", () => ({
  get: vi.fn(async (url) => {
    if (url !== "/api/tunnel/status") throw new Error(`unexpected ${url}`);
    server.statusReads += 1;
    return server.status;
  }),
}));
vi.mock("../../src/app/(dashboard)/dashboard/providers/workflowRequests.js", () => ({
  requestJSON: async () => server.status,
}));
vi.mock("../../src/app/(dashboard)/dashboard/endpoint/components/MonitoringStrip", () => ({ default: () => null }));
vi.mock("@/shared/ui/v5/production/uiVersion.js", () => ({ useUiV5: () => false }));

const { default: EndpointPageClient } = await import("../../src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.jsx");

const ENDPOINTS = [
  {
    name: "Cloudflare",
    url: "https://cf.example",
    status: (enabled, other = false) => ({ tunnel: { enabled, tunnelUrl: "https://cf.example", publicUrl: "" }, tailscale: { enabled: other, tunnelUrl: "https://ts.example" } }),
    reachableLabel: "https://cf.example/v1",
    reconnecting: "Tunnel reconnecting...",
  },
  {
    name: "Tailscale",
    url: "https://ts.example",
    status: (enabled, other = false) => ({ tunnel: { enabled: other, tunnelUrl: "https://cf.example", publicUrl: "" }, tailscale: { enabled, tunnelUrl: "https://ts.example" } }),
    reachableLabel: "https://ts.example/v1",
    reconnecting: "Tailscale reconnecting...",
  },
];

let host, root, healthy, probes, down;
beforeEach(() => {
  vi.useFakeTimers();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  healthy = true;
  down = new Set();
  probes = 0;
  server.statusReads = 0;
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    if (!String(url).endsWith("/api/health")) throw new Error(`unexpected fetch ${url}`);
    probes += 1;
    return { ok: healthy && !down.has(new URL(url).origin) };
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
const reachable = (endpoint) => host.textContent.includes(endpoint.reachableLabel);

/** Advances one probe interval and returns the probes and status reads it caused. */
async function step(ms) {
  const before = { probes, statusReads: server.statusReads };
  await advance(ms);
  return { probes: probes - before.probes, statusReads: server.statusReads - before.statusReads };
}

describe.each(ENDPOINTS)("$name endpoint probe streak under polling", (endpoint) => {
  it("ignores status polls, flips after the miss threshold, and restarts the streak on recovery", async () => {
    server.status = endpoint.status(true);
    act(() => root.render(React.createElement(EndpointPageClient)));
    await advance(0);
    expect(reachable(endpoint)).toBe(true);
    expect(probes).toBeGreaterThan(0);

    // Healthy cadence: probes every CLIENT_PING_SLOW_MS, status every STATUS_POLL_SLOW_MS.
    healthy = false;
    let statusReadsWhileFailing = 0;
    for (let miss = 1; miss < REACHABLE_MISS_THRESHOLD; miss++) {
      const counts = await step(CLIENT_PING_SLOW_MS);
      expect(counts.probes).toBe(1);
      statusReadsWhileFailing += counts.statusReads;
      expect(reachable(endpoint)).toBe(true);
    }
    // Status reads outnumber the threshold yet did not count as misses.
    expect(statusReadsWhileFailing).toBe((REACHABLE_MISS_THRESHOLD - 1) * (CLIENT_PING_SLOW_MS / STATUS_POLL_SLOW_MS));
    expect(statusReadsWhileFailing).toBeGreaterThanOrEqual(REACHABLE_MISS_THRESHOLD);

    await step(CLIENT_PING_SLOW_MS);
    expect(reachable(endpoint)).toBe(false);
    expect(host.textContent).toContain(endpoint.reconnecting);

    // Degraded cadence: the next completed probe that passes restores reachability.
    healthy = true;
    const recovery = await step(CLIENT_PING_FAST_MS);
    expect(recovery.probes).toBeGreaterThan(0);
    expect(reachable(endpoint)).toBe(true);

    // The streak starts again from zero after recovery.
    healthy = false;
    for (let miss = 1; miss < REACHABLE_MISS_THRESHOLD; miss++) {
      await step(CLIENT_PING_SLOW_MS);
      expect(reachable(endpoint)).toBe(true);
    }
    await step(CLIENT_PING_SLOW_MS);
    expect(reachable(endpoint)).toBe(false);
  });

  it("does not count a status-poll failure as a probe miss", async () => {
    server.status = endpoint.status(true);
    act(() => root.render(React.createElement(EndpointPageClient)));
    await advance(0);
    const { get } = await import("@/shared/utils/api");
    get.mockRejectedValue(new Error("status unavailable"));
    try {
      for (let i = 0; i < REACHABLE_MISS_THRESHOLD + 1; i++) await step(CLIENT_PING_SLOW_MS);
      expect(reachable(endpoint)).toBe(true);
    } finally {
      get.mockReset();
      get.mockImplementation(async () => { server.statusReads += 1; return server.status; });
    }
  });

  it("starts unreachable when re-enabled after a disable seen by the status poll", async () => {
    // The other endpoint stays on, so the status poll keeps running.
    server.status = endpoint.status(true, true);
    act(() => root.render(React.createElement(EndpointPageClient)));
    await advance(0);
    expect(reachable(endpoint)).toBe(true);

    server.status = endpoint.status(false, true);
    await step(STATUS_POLL_SLOW_MS);
    expect(reachable(endpoint)).toBe(false);

    // Re-enabled elsewhere while this endpoint does not answer yet.
    down.add(endpoint.url);
    server.status = endpoint.status(true, true);
    const before = probes;
    await step(STATUS_POLL_SLOW_MS);
    expect(probes).toBeGreaterThan(before);
    expect(reachable(endpoint)).toBe(false);
    expect(host.textContent).toContain(endpoint.reconnecting);
  });
});

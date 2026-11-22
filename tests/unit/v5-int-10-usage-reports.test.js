// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import UsageChart from "../../src/app/(dashboard)/dashboard/usage/components/UsageChart.js";
import ApiKeyLimitsCard from "../../src/app/(dashboard)/dashboard/keys/components/ApiKeyLimitsCard.js";

vi.mock("recharts", () => ({
  AreaChart: ({ children }) => React.createElement("div", null, children), Area: () => null, XAxis: () => null, YAxis: () => null,
  CartesianGrid: () => null, Tooltip: () => null, ResponsiveContainer: ({ children }) => React.createElement("div", null, children),
}));

let root, host;
const ok = (body) => ({ ok: true, json: async () => body });
const chartUrl = () => `/api/usage/chart?period=7d&tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.stubGlobal("fetch", vi.fn(async () => ok([{ label: "Today", tokens: 12, cost: 0.1 }])));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); delete document.documentElement.dataset.ui;
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});
async function render(enabled) {
  if (enabled) document.documentElement.dataset.ui = "v5"; else delete document.documentElement.dataset.ui;
  await act(async () => root.render(React.createElement(UsageChart, { period: "7d" })));
  await act(async () => {});
}

describe.each([false, true])("usage reports, V5 %s", (enabled) => {
  it("retains the chart request contract", async () => {
    await render(enabled);
    expect(fetch).toHaveBeenCalledWith(chartUrl(), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(document.body.textContent).toContain("Today");
  });
});

it("shows chart failure feedback and retries the identical URL in V5", async () => {
  document.documentElement.dataset.ui = "v5";
  fetch.mockRejectedValueOnce(new Error("offline"));
  await act(async () => root.render(React.createElement(UsageChart, { period: "7d" })));
  await act(async () => {});
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Unable to load usage chart");
  await act(async () => document.querySelector('button')?.click());
  await act(async () => {});
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([chartUrl(), chartUrl()]);
  expect(document.body.textContent).toContain("Today");
});

it("retains key-limit data, exposes a focusable table region, and retries the same reads", async () => {
  document.documentElement.dataset.ui = "v5";
  let failed = true;
  fetch.mockImplementation(async (url) => {
    if (failed) return { ok: false, json: async () => ({}) };
    if (url === "/api/keys") return ok({ keys: [{ id: "key-1", name: "Primary" }] });
    return ok({ usage: { "key-1": { rpm: { limit: 10, used: 2 } } } });
  });
  await act(async () => root.render(React.createElement(ApiKeyLimitsCard)));
  await act(async () => {});
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Unable to load API key limits");
  failed = false;
  await act(async () => document.querySelector('button')?.click());
  await act(async () => {});
  const region = document.querySelector('[role="region"][tabindex="0"]');
  expect(region?.getAttribute("aria-label")).toBe("API key limits for Primary");
  region.focus(); expect(document.activeElement).toBe(region);
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    "/api/keys", "/api/keys/usage", "/api/keys", "/api/keys/usage",
  ]);
});

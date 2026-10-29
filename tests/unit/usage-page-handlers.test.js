// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { USAGE_PERIOD_OPTIONS } from "@/lib/usagePeriods.js";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
// The topology is browser-only; totals, date controls and the reset dialog are real.
vi.mock("next/dynamic", () => ({ default: () => () => null }));
import UsagePage from "@/app/(dashboard)/dashboard/usage/page.js";

const stats = (totalRequests, totalPromptTokens) => ({
  totalRequests, totalPromptTokens, totalCompletionTokens: 0, totalCachedTokens: 0, totalCost: 0,
  byModel: {}, byProvider: {}, byAccount: {}, byApiKey: {}, byEndpoint: {},
  pending: { byModel: {}, byAccount: {}, byKey: {} },
  activeRequests: [], activeSessions: [], recentRequests: [],
});
const response = (body) => ({ ok: true, json: async () => body });
let root;
let host;
const click = async (element) => act(async () => { element.click(); });
const button = (scope, label) => [...scope.querySelectorAll("button")].find((node) => node.textContent.trim().endsWith(label));
const setDate = async (input, value) => act(async () => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
});
const displayedNumber = (value) => [...host.querySelectorAll("span")].some((node) =>
  node.childElementCount === 0 && node.textContent.trim() === new Intl.NumberFormat().format(value)
);

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("EventSource", class { close() {} });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("usage reset", () => {
  it("refetches and renders real totals after reset while preserving a selected custom range", async () => {
    let reset = false;
    let resolveRefreshed;
    const statsRequests = [];
    const fetch = vi.fn((input, options = {}) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/usage/stats") {
        statsRequests.push(url);
        if (reset) return new Promise((resolve) => { resolveRefreshed = resolve; });
        return Promise.resolve(response(stats(137, 983)));
      }
      if (url.pathname === "/api/usage/reset" && options.method === "POST") {
        reset = true;
        return Promise.resolve(response({ success: true }));
      }
      const bodies = {
        "/api/providers": { connections: [] },
        "/api/provider-nodes": { nodes: [] },
        "/api/settings": { disabledFreeProviders: [] },
        "/api/usage/chart": [],
        "/api/monitoring": { runtime: {}, activity: {}, health: [] },
      };
      if (!Object.hasOwn(bodies, url.pathname)) throw new Error(`Unexpected request: ${url.pathname}`);
      return Promise.resolve(response(bodies[url.pathname]));
    });
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(React.createElement(UsagePage)));
    expect(displayedNumber(137)).toBe(true);
    expect(displayedNumber(983)).toBe(true);

    const range = host.querySelector('[role="group"][aria-label="Date range"]');
    await click(button(range, USAGE_PERIOD_OPTIONS.find((option) => option.value === "7d").label));
    const custom = range.querySelector('button[aria-haspopup="dialog"]');
    await click(custom);
    const [from, to] = range.parentElement.querySelectorAll('input[type="date"]');
    await setDate(from, "2026-02-03");
    await setDate(to, "2026-02-09");
    await click(button(range.parentElement.querySelector('[role="dialog"]'), "Apply"));
    expect(custom.getAttribute("aria-pressed")).toBe("true");
    const selectedQuery = statsRequests.at(-1).search;
    expect(Object.fromEntries(statsRequests.at(-1).searchParams)).toEqual({
      period: "7d", startDate: "2026-02-03", endDate: "2026-02-09",
    });
    const beforeReset = statsRequests.length;

    await click(button(host, "Reset"));
    const dialog = document.body.querySelector("dialog");
    expect(dialog).not.toBeNull();
    expect(dialog.open).toBe(true);
    await click(button(dialog, "Reset"));
    expect(fetch).toHaveBeenCalledWith("/api/usage/reset", expect.objectContaining({ method: "POST", body: JSON.stringify({ period: "all" }) }));
    expect(statsRequests).toHaveLength(beforeReset + 1);
    expect(statsRequests.at(-1).search).toBe(selectedQuery);
    expect(document.body.querySelector("dialog")).toBeNull();
    expect(displayedNumber(137)).toBe(true);

    await act(async () => resolveRefreshed(response(stats(41, 127))));
    expect(displayedNumber(41)).toBe(true);
    expect(displayedNumber(127)).toBe(true);
    expect(displayedNumber(137)).toBe(false);
    expect(displayedNumber(983)).toBe(false);
    expect(custom.getAttribute("aria-pressed")).toBe("true");
    await click(custom);
    expect([...range.parentElement.querySelectorAll('input[type="date"]')].map((input) => input.value))
      .toEqual(["2026-02-03", "2026-02-09"]);
  });
});

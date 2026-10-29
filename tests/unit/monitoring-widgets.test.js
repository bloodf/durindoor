// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import MonitoringWidgets from "@/app/(dashboard)/dashboard/usage/components/MonitoringWidgets.jsx";

vi.mock("@/i18n/runtime", () => ({ translate: (value) => value }));
let root;
let host;
const payload = { version: "4.11.0", latencyMs: 12, runtime: { activeDetail: [{ provider: "openai", model: "gpt-5", account: "Primary", count: 2 }] }, activity: { today: { requests: 321 } }, health: [{ id: "openai", name: "OpenAI", requests: 321, errors: 2, successRate: 99.4 }] };
const mount = async () => act(async () => root.render(React.createElement(MonitoringWidgets)));
const click = async (label) => act(async () => [...host.querySelectorAll("button")].find((node) => node.textContent.trim().endsWith(label)).click());
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { if (root) await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("monitoring widgets", () => {
  it("shows in-flight requests and recorded health, refreshes every 15 seconds and stops when paused", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => payload }); vi.stubGlobal("fetch", fetch);
    await mount();
    expect(host.textContent).toContain("openai · gpt-5 · Primary");
    expect(host.textContent).toContain("99.4%");
    expect(host.textContent).toContain("321");
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(fetch).toHaveBeenCalledTimes(2);
    await click("Live");
    const pausedCalls = fetch.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(30000));
    expect(fetch).toHaveBeenCalledTimes(pausedCalls);
    await click("Refresh");
    expect(fetch).toHaveBeenCalledTimes(pausedCalls + 1);
    await act(async () => root.unmount()); root = null;
    await act(async () => vi.advanceTimersByTimeAsync(30000));
    expect(fetch).toHaveBeenCalledTimes(pausedCalls + 1);
  });

  it("reports a failed request and recovers on manual refresh", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValue({ ok: true, json: async () => payload }));
    await mount();
    expect(host.querySelector('[role="alert"]').textContent).toContain("HTTP 503");
    expect(host.textContent).not.toContain("Online");
    await click("Refresh");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).toContain("Online");
  });

  it("ignores a late response after navigation", async () => {
    let resolve;
    const pending = new Promise((done) => { resolve = done; });
    const fetch = vi.fn(() => pending); vi.stubGlobal("fetch", fetch);
    await mount();
    const signal = fetch.mock.calls[0][1].signal;
    await act(async () => root.unmount()); root = null;
    expect(signal.aborted).toBe(true);
    await act(async () => resolve({ ok: true, json: async () => payload }));
    expect(host.textContent).toBe("");
  });
});

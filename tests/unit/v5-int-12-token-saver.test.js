// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("recharts", () => ({
  AreaChart: ({ children }) => React.createElement("div", null, children), Area: () => null, XAxis: () => null, YAxis: () => null,
  CartesianGrid: () => null, Tooltip: () => null, ResponsiveContainer: ({ children }) => React.createElement("div", null, children),
}));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }) => React.createElement("a", { href, ...rest }, children) }));
vi.mock("@/shared/ui/v5/motion/MotionIcon.jsx", () => ({ default: () => null }));
vi.mock("@/shared/ui/components/Modal.jsx", () => ({ default: ({ open, title, children, footer }) => open ? React.createElement("div", { role: "dialog", "aria-label": title }, children, footer) : null }));

import TokenSaverClient from "../../src/app/(dashboard)/dashboard/token-saver/TokenSaverClient.jsx";
import { SAVER_WIDGETS, TOKEN_SAVER_LAYOUT_KEY } from "../../src/shared/ui/v5/dashboards/model.js";

let root, host, streams, fetchMock, writes;
class FakeStream {
  constructor(url) { this.url = url; this.close = vi.fn(); streams.push(this); }
}
const json = (body, ok = true, status = ok ? 200 : 503) => ({ ok, status, json: async () => body });
const SETTINGS = { rtkEnabled: true, headroomEnabled: false, headroomUrl: "http://localhost:8787", headroomTimeoutMs: 15000, cavemanEnabled: false, ponytailEnabled: false, pxpipeEnabled: false, pxpipeMinChars: 25000, pxpipeTimeoutMs: 15000, pxpipeAllowedModels: [] };
const STATS = { requestsObserved: 5, rtk: { bytesSaved: 2048, requestsWithHits: 3, hits: 7 }, headroom: { tokensSaved: 100, compressed: 2, skipReasons: { disabled: 2 } }, totals: { actualBytesSaved: 3072 }, pxpipe: { tokensSavedEst: 88, applied: 1, imageCount: 2 }, dailyPoints: [] };
let patchBehavior;
function route(url, init = {}) {
  const method = init.method || "GET";
  if (url === "/api/settings" && method === "PATCH") { writes.push([url, init]); return patchBehavior(init); }
  if (url === "/api/settings") return json(SETTINGS);
  if (url === "/api/headroom/status") return json({ installed: false, running: false, localUrl: true });
  if (url === "/api/headroom/extras") return json({ installed: false, extras: {}, available: [] });
  if (url.startsWith("/api/pxpipe/status")) return json({ installed: true, running: true, version: "1.4.0" });
  if (url.startsWith("/api/pxpipe/stats")) return json({ windows: {}, recent: [], timeline: [] });
  if (url.startsWith("/api/pxpipe/logs")) return json({ events: [] });
  if (url.startsWith("/api/pxpipe/health")) return json({ healthy: true });
  return json({});
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  streams = []; writes = []; patchBehavior = () => json({ success: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  fetchMock = vi.fn(async (url, init) => route(String(url), init));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("EventSource", FakeStream);
  try { localStorage.clear(); } catch {}
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); delete document.documentElement.dataset.ui;
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});
async function render(view, v5) {
  if (v5) document.documentElement.dataset.ui = "v5"; else delete document.documentElement.dataset.ui;
  await act(async () => root.render(React.createElement(TokenSaverClient, { view })));
  await act(async () => {});
}
const button = (label) => [...host.querySelectorAll("button")].find((item) => item.getAttribute("aria-label") === label || item.textContent.trim().includes(label));
const click = async (label) => { const target = button(label); expect(target, label).toBeTruthy(); await act(async () => target.click()); await act(async () => {}); };
const lastStream = () => streams[streams.length - 1];

describe("Token Saver monitoring dashboard", () => {
  it("renders the incumbent overview when the switch is off", async () => {
    await render("overview", false);
    expect(host.querySelector(".v5-dashboard-page")).toBeNull();
    expect(host.textContent).toContain("Aggregate pre-provider compression metrics");
    expect(fetchMock.mock.calls.map(([url]) => url)).toContain("/api/settings");
  });

  it("renders the nine-widget V5 canvas with labelled regions and a settings link", async () => {
    await render("overview", true);
    expect(host.querySelector(".v5-dashboard-page")).toBeTruthy();
    for (const widget of SAVER_WIDGETS) expect(host.querySelector(`section[aria-label="${widget.title}"]`), widget.title).toBeTruthy();
    expect(host.querySelector('a[href="/dashboard/token-saver/settings"]')?.textContent).toContain("Compression settings");
    expect(streams[0].url).toBe("/api/token-saver/stream?period=30d");
  });

  it("labels actual bytes and estimated tokens separately", async () => {
    await render("overview", true);
    await act(async () => lastStream().onmessage({ data: JSON.stringify(STATS) }));
    expect(host.textContent).toContain("Actual payload shrink");
    expect(host.textContent).toContain("Estimated image tokens. Separate from actual bytes.");
  });

  it("shows loading, then empty, states for the aggregate widgets", async () => {
    await render("overview", true);
    expect(host.textContent).toContain("Loading Token Saver metrics");
    await act(async () => lastStream().onmessage({ data: JSON.stringify({ ...STATS, requestsObserved: 0 }) }));
    expect(host.textContent).toContain("No Token Saver events yet");
  });

  it("keeps the last snapshot after a stream failure and Retry reconnects", async () => {
    await render("overview", true);
    await act(async () => lastStream().onmessage({ data: JSON.stringify(STATS) }));
    await act(async () => lastStream().onerror());
    const alert = host.querySelector('[role="alert"]');
    expect(alert.textContent).toContain("Previously received metrics remain visible");
    expect(host.textContent).toContain("2.0 KB");
    const failed = lastStream();
    await click("Retry Token Saver stream");
    expect(failed.close).toHaveBeenCalled();
    expect(streams).toHaveLength(2);
  });

  it("writes only the production layout key and never the review key", async () => {
    await render("overview", true);
    await click("Customize dashboard");
    await click("Hide Actual bytes saved");
    await click("Save layout");
    const saved = JSON.parse(localStorage.getItem(TOKEN_SAVER_LAYOUT_KEY));
    expect(TOKEN_SAVER_LAYOUT_KEY).toBe("durindoor:token-saver-layout:v1");
    expect(saved.find((widget) => widget.id === "saver-bytes").visible).toBe(false);
    expect(Object.keys(localStorage).filter((key) => key.startsWith("durindoor:v5-review:"))).toEqual([]);
    expect(host.textContent).toContain("Dashboard layout saved.");
    expect(host.textContent).not.toContain("for this review");
  });

  it("keeps the view and shows a notice when browser storage is blocked", async () => {
    await render("overview", true);
    const blocked = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    await click("Customize dashboard");
    await click("Save layout");
    expect(blocked).toHaveBeenCalledWith(TOKEN_SAVER_LAYOUT_KEY, expect.any(String));
    expect(host.textContent).toContain("Browser storage is unavailable");
    expect(host.querySelector('section[aria-label="Compression overview"]')).toBeTruthy();
  });

  it("stops the aggregate subscription when every saver widget is hidden", async () => {
    await render("overview", true);
    const stream = lastStream();
    await click("Customize dashboard");
    for (const title of ["Compression overview", "Actual bytes saved", "Image token estimate", "Headroom skip reasons"]) await click(`Hide ${title}`);
    expect(stream.close).toHaveBeenCalled();
    expect(streams).toHaveLength(1);
  });

  it("restores the saved layout when changes are cancelled", async () => {
    await render("overview", true);
    await click("Customize dashboard");
    await click("Hide Actual bytes saved");
    expect(host.querySelector('section[aria-label="Actual bytes saved"]')).toBeNull();
    await click("Cancel layout changes");
    expect(host.querySelector('section[aria-label="Actual bytes saved"]')).toBeTruthy();
  });

  it("renders the incumbent settings for view=settings even when V5 is on", async () => {
    await render("settings", true);
    expect(host.querySelector(".v5-dashboard-page")).toBeNull();
    expect(host.textContent).toContain("Token Saver settings");
    expect(host.querySelector('[role="switch"][aria-label="Enable RTK"]')).toBeTruthy();
  });
});

describe("Token Saver settings states", () => {
  it("rolls a rejected PATCH back and offers a retry", async () => {
    patchBehavior = () => json({ error: "Settings storage unavailable" }, false);
    await render("settings", true);
    const toggle = host.querySelector('[role="switch"][aria-label="Enable RTK"]');
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await act(async () => toggle.click()); await act(async () => {});
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("RTK: Not saved. Settings storage unavailable");
    patchBehavior = () => json({ success: true });
    await click("Retry RTK");
    expect(host.textContent).toContain("RTK: Saved");
  });

  it("blocks a duplicate submit while a write is pending and marks the status region busy", async () => {
    let release;
    patchBehavior = () => new Promise((resolve) => { release = () => resolve(json({ success: true })); });
    await render("settings", true);
    const toggle = host.querySelector('[role="switch"][aria-label="Enable RTK"]');
    await act(async () => toggle.click());
    await act(async () => toggle.click());
    expect(writes).toHaveLength(1);
    expect(toggle.disabled || toggle.getAttribute("aria-disabled") === "true").toBe(true);
    expect(host.querySelector('[aria-label="Settings save status"]').getAttribute("aria-busy")).toBe("true");
    await act(async () => { release(); }); await act(async () => {});
    expect(host.querySelector('[aria-label="Settings save status"]').getAttribute("aria-busy")).toBe("false");
  });

  it("shows a status message while settings load and an alert when they cannot load", async () => {
    fetchMock.mockImplementation(async (url, init) => String(url) === "/api/settings" && !init?.method ? json({}, false) : route(String(url), init));
    await render("settings", true);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Unable to load settings");
  });
});

describe("A3 parity: primary write action with the switch on and off", () => {
  it("issues the same settings PATCH", async () => {
    const calls = {};
    for (const v5 of [false, true]) {
      writes.length = 0;
      await render("settings", v5);
      await act(async () => host.querySelector('[role="switch"][aria-label="Enable RTK"]').click()); await act(async () => {});
      calls[v5] = writes.map(([url, init]) => [url, init.method, JSON.stringify(init.headers), init.body]);
      await act(async () => root.render(null));
    }
    expect(calls[true]).toEqual(calls[false]);
    expect(calls[true]).toEqual([["/api/settings", "PATCH", JSON.stringify({ "Content-Type": "application/json" }), JSON.stringify({ rtkEnabled: false })]]);
  });

  it("keeps the incumbent settings DOM free of V5-only attributes when the switch is off", async () => {
    await render("settings", false);
    expect(host.querySelector('[aria-label="Settings save status"]').hasAttribute("aria-busy")).toBe(false);
    expect(host.querySelector('[aria-label="Settings save status"]').hasAttribute("role")).toBe(false);
  });
});

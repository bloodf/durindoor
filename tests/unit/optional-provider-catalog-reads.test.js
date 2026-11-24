// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ComboUsageReport from "../../src/app/(dashboard)/dashboard/combos/components/ComboUsageReport.jsx";
import Compression from "../../src/app/(dashboard)/dashboard/compression-studio/page.js";

const flush = () => new Promise((resolve) => setTimeout(resolve, 30));
let host, root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
});

async function render(Component, props = {}) {
  await act(async () => { root.render(React.createElement(Component, props)); await flush(); });
}

describe("optional provider catalog reads", () => {
  it("keeps Combo Usage's initial fallback on HTTP errors without reading the body", async () => {
    const json = vi.fn(async () => { throw new Error("body must not be read"); });
    vi.stubGlobal("fetch", vi.fn(async (url) => url === "/api/providers"
      ? { ok: false, status: 503, statusText: "Unavailable", json }
      : { ok: true, json: async () => ({ rows: [{ comboId: "c", comboName: "combo", connectionId: "conn-abc", requests: 1 }], modelBreakdown: [] }) }));
    await render(ComboUsageReport, { period: "7d", customRange: {}, resetNonce: 0 });
    expect(fetch).toHaveBeenCalledWith("/api/providers", expect.objectContaining({ cache: "no-store" }));
    expect(json).not.toHaveBeenCalled();
    expect(Array.from(host.querySelectorAll("table td"), (cell) => cell.textContent)).toContain("conn");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("resolves Combo Usage connection names from a successful catalog response", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => ({ ok: true, json: async () => url === "/api/providers"
      ? { connections: [{ id: "conn-abc", name: "Primary account" }] }
      : { rows: [{ comboId: "c", comboName: "combo", connectionId: "conn-abc", requests: 1 }], modelBreakdown: [] } })));
    await render(ComboUsageReport, { period: "7d", customRange: {}, resetNonce: 0 });
    expect(host.textContent).toContain("Primary account");
  });

  it("shows Compression's provider failure state without reading an HTTP error body", async () => {
    const json = vi.fn(async () => { throw new Error("body must not be read"); });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, statusText: "Unavailable", json })));
    await render(Compression);
    expect(fetch).toHaveBeenCalledWith("/api/providers", expect.any(Object));
    expect(json).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Could not load providers");
  });
});

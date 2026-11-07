// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { catalogDiscoveryStatus } from "../../src/shared/utils/catalogDiscoveryStatus.js";
import ModelCatalogProvenance from "../../src/app/(dashboard)/dashboard/providers/[id]/ModelCatalogProvenance.js";
import ModelAutoSyncPanel from "../../src/app/(dashboard)/dashboard/providers/[id]/ModelAutoSyncPanel.js";

const now = Date.parse("2026-11-07T12:00:00Z");
const status = { enabled: true, models: [], syncedAt: "2026-11-07T11:00:00Z", intervalHours: 2 };

describe("catalog discovery provenance", () => {
  it("uses the configured interval without claiming live availability", () => {
    expect(catalogDiscoveryStatus(status, now)).toBe("Within the configured sync interval. Availability is not verified.");
    expect(catalogDiscoveryStatus({ ...status, intervalHours: 1 }, now)).toBe("STALE. The stored snapshot is older than the configured sync interval.");
  });
  it("distinguishes failed retained snapshots from unknown discovery", () => {
    expect(catalogDiscoveryStatus({ ...status, error: "failed" }, now)).toBe("STALE. The last discovery attempt failed; the previous snapshot is retained.");
    for (const patch of [{ syncedAt: null }, { syncedAt: "invalid" }, { syncedAt: "2027-01-01" }, { intervalHours: null }]) {
      expect(catalogDiscoveryStatus({ ...status, ...patch }, now)).toBe("UNKNOWN");
    }
    expect(catalogDiscoveryStatus({ error: "failed" }, now)).toBe("UNKNOWN");
  });
  it("renders the effective runtime source separately from unverified vendor identity", () => {
    const render = (patch) => renderToStaticMarkup(React.createElement(ModelCatalogProvenance, { providerId: "openai", status: { ...status, ...patch } }));
    expect(render({})).toContain("Provider discovery with derived registry variants");
    expect(render({ enabled: false })).toContain("Built-in registry");
    expect(render({ models: null })).toContain("Built-in registry");
    expect(render({ syncedAt: null })).toContain("UNKNOWN");
    expect(render({})).toContain("A list-models response does not verify the model vendor or its capabilities.");
  });
});

describe("model auto-sync panel discovery response", () => {
  let container;
  let root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(now);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each([
    [2, {}, "Within the configured sync interval. Availability is not verified."],
    [1, {}, "STALE. The stored snapshot is older than the configured sync interval."],
    [2, { syncedAt: null }, "UNKNOWN"],
    [undefined, {}, "UNKNOWN"],
    [2, { enabled: false, models: null }, "Within the configured sync interval. Availability is not verified."],
  ])("renders GET interval %s and provider status %j through the actual effect", async (intervalHours, patch, expected) => {
    const models = [{ id: "gpt-6", name: "GPT-6", capabilities: { contextWindow: 128000 } }];
    const provider = { eligible: true, enabled: true, models, syncedAt: status.syncedAt, newModelIds: [], removedModelIds: [], ...patch };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ intervalHours, providers: { openai: provider } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const onModelsChange = vi.fn();

    await act(async () => {
      root.render(React.createElement(ModelAutoSyncPanel, { providerId: "openai", hasConnection: true, onModelsChange }));
    });

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/models/auto-sync?provider=openai", { cache: "no-store" });
    expect(onModelsChange).toHaveBeenCalledExactlyOnceWith(provider.models);
    const provenance = container.querySelector('dl[aria-label="Model list provenance"]');
    const valueFor = (label) => [...provenance.querySelectorAll("dt")].find((element) => element.textContent === label).nextElementSibling.textContent;
    expect(valueFor("Discovery freshness: ")).toBe(expected);
    await act(async () => { vi.advanceTimersByTime(3600000); });
    expect(valueFor("Discovery freshness: ")).toBe(
      expected === "Within the configured sync interval. Availability is not verified." ?
        "STALE. The stored snapshot is older than the configured sync interval." : expected
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(valueFor("Runtime list source: ")).toBe(provider.enabled ? "Provider discovery with derived registry variants" : "Built-in registry");
    expect(container.querySelector('[role="switch"]').getAttribute("aria-checked")).toBe(String(provider.enabled));
  });

  it.each([
    [{ syncedAt: null }, "UNKNOWN", 0],
    [{ syncedAt: "invalid" }, "UNKNOWN", 0],
    [{ syncedAt: "2027-01-01" }, "UNKNOWN", 0],
    [{ intervalHours: 0 }, "UNKNOWN", 0],
    [{ intervalHours: Number.MAX_VALUE }, "Within the configured sync interval. Availability is not verified.", 0],
    [{ intervalHours: 10000 }, "Within the configured sync interval. Availability is not verified.", 1],
  ])("handles unschedulable or long evidence %j without overflow", async (patch, expected, timers) => {
    await act(async () => root.render(React.createElement(ModelCatalogProvenance, { providerId: "openai", status: { ...status, ...patch } })));
    expect(container.querySelector("dl").textContent).toContain(`Discovery freshness: ${expected}`);
    expect(vi.getTimerCount()).toBe(timers);
    await act(async () => { vi.advanceTimersByTime(3600000); });
    expect(container.querySelector("dl").textContent).toContain(`Discovery freshness: ${expected}`);
    expect(vi.getTimerCount()).toBe(timers);
  });

  it("replaces the boundary timer on status change and clears it on unmount", async () => {
    const render = (patch) => root.render(React.createElement(ModelCatalogProvenance, { providerId: "openai", status: { ...status, ...patch } }));
    await act(async () => render({}));
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => render({ intervalHours: 3 }));
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => { vi.advanceTimersByTime(3600000); });
    expect(container.querySelector("dl").textContent).toContain("Discovery freshness: Within the configured sync interval. Availability is not verified.");
    await act(async () => render({ syncedAt: null }));
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => render({ intervalHours: 3 }));
    expect(vi.getTimerCount()).toBe(1);
    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    root = createRoot(container);
  });

});

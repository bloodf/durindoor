// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import ModelAutoSyncPanel from "../../src/app/(dashboard)/dashboard/providers/[id]/ModelAutoSyncPanel.js";

const cached = [{ id: "fixture-cached", name: "Cached fixture" }];
const updated = [{ id: "fixture-updated", name: "Updated fixture" }];
const catalog = (models) => ({
  ok: true,
  json: async () => ({ intervalHours: 2, providers: { openai: {
    eligible: true, enabled: true, models, syncedAt: "2026-11-07T12:00:00Z",
    newModelIds: [], removedModelIds: [],
  } } }),
});
const synced = () => ({ ok: true, json: async () => ({ results: [{ status: "synced", modelCount: 1 }] }) });

describe("manual model discovery failure feedback", () => {
  let container;
  let root;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });


  it("keeps a confirmed toggle setting when the catalog refresh fails", async () => {
    const onModelsChange = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(catalog(cached))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ modelAutoSyncProviders: { other: true } }) })
      .mockResolvedValueOnce({ ok: true }).mockRejectedValueOnce(new Error("Offline")));
    await act(async () => root.render(React.createElement(ModelAutoSyncPanel, { providerId: "openai", hasConnection: true, onModelsChange })));
    await act(async () => container.querySelector('[role="switch"]').click());
    expect(container.querySelector('[role="switch"]').getAttribute("aria-checked")).toBe("false");
    expect(container.querySelector('[role="switch"]').disabled).toBe(false);
    expect(container.querySelector('[role="status"]').textContent).toBe("Could not refresh the model list. The displayed list is unchanged. Try Sync now again.");
    expect(onModelsChange.mock.calls).toEqual([[cached]]);
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ modelAutoSyncProviders: { other: true, openai: false } });
  });

  it.each(["initial GET", "sync POST"])("does not publish an old provider after unmount during %s", async (pending) => {
    const onModelsChange = vi.fn();
    let finishOld;
    const newModels = [{ id: "new-provider-model" }];
    const newCatalog = { ok: true, json: async () => ({ providers: { anthropic: { eligible: true, enabled: true, models: newModels, newModelIds: [], removedModelIds: [] } } }) };
    const fetchMock = vi.fn();
    if (pending === "initial GET") fetchMock.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
    else fetchMock.mockResolvedValueOnce(catalog(cached)).mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
    fetchMock.mockResolvedValueOnce(newCatalog);
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(React.createElement(ModelAutoSyncPanel, { key: "old", providerId: "openai", hasConnection: true, onModelsChange })));
    if (pending === "sync POST") await act(async () => [...container.querySelectorAll("button")].find((node) => /Sync now/.test(node.textContent)).click());
    await act(async () => root.render(React.createElement(ModelAutoSyncPanel, { key: "new", providerId: "anthropic", hasConnection: true, onModelsChange })));
    const calls = onModelsChange.mock.calls.slice();
    expect(calls.at(-1)).toEqual([newModels]);
    await act(async () => finishOld(pending === "initial GET" ? catalog(cached) : synced()));
    expect(onModelsChange.mock.calls).toEqual(calls);
    expect(fetchMock).toHaveBeenCalledTimes(pending === "initial GET" ? 2 : 3);
  });

  it.each(["POST rejection", "GET rejection", "GET HTTP failure"])("retains the catalog after %s, releases pending and retries", async (failure) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(catalog(cached));
    let rejectPost;
    if (failure === "POST rejection") {
      fetchMock.mockImplementationOnce(() => new Promise((resolve, reject) => { rejectPost = reject; }));
    } else {
      fetchMock.mockResolvedValueOnce(synced());
      if (failure === "GET rejection") fetchMock.mockRejectedValueOnce(new TypeError("inert offline fixture"));
      else fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    }
    fetchMock.mockResolvedValueOnce(synced()).mockResolvedValueOnce(catalog(updated));
    vi.stubGlobal("fetch", fetchMock);
    const onModelsChange = vi.fn();
    await act(async () => root.render(React.createElement(ModelAutoSyncPanel, {
      providerId: "openai", hasConnection: true, onModelsChange,
    })));
    const button = () => [...container.querySelectorAll("button")].find((node) => /Sync now|Syncing/.test(node.textContent));
    expect(onModelsChange).toHaveBeenCalledExactlyOnceWith(cached);
    await act(async () => button().click());
    if (rejectPost) {
      expect(button().disabled).toBe(true);
      expect(container.querySelector('[role="switch"]').disabled).toBe(true);
      await act(async () => rejectPost(new TypeError("inert offline fixture")));
    }
    expect(button().disabled).toBe(false);
    expect(container.querySelector('[role="switch"]').disabled).toBe(false);
    expect(container.querySelector('[role="status"]').textContent).toBe(failure === "POST rejection"
      ? "Could not sync models. The displayed list is unchanged. Try Sync now again."
      : "Could not refresh the model list. The displayed list is unchanged. Try Sync now again.");
    expect(onModelsChange).toHaveBeenCalledExactlyOnceWith(cached);
    expect(container.querySelector('[role="switch"]').getAttribute("aria-checked")).toBe("true");
    await act(async () => button().click());
    expect(onModelsChange.mock.calls).toEqual([[cached], [updated]]);
    expect(container.querySelector('[role="status"]').textContent).toBe("Synced 1 models.");
    expect(button().disabled).toBe(false);
    expect(fetchMock.mock.calls.every(([url, options]) => url.startsWith("/api/models/auto-sync") && (!options.method || options.method === "POST"))).toBe(true);
  });
});

// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import useSettingsStore from "@/store/settingsStore";
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "openai" }), useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));
import ProviderDetailPage from "@/app/(dashboard)/dashboard/providers/[id]/page.js";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { vi.unstubAllGlobals(); useSettingsStore.setState({ settings: null, lastFetched: 0, loading: false, error: null }); });
function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "api" ? [] : sourceFiles(file);
    return /\.(js|jsx)$/.test(file) && !file.includes(".stories.") ? [file] : [];
  });
}
describe("settings store callers", () => {
  it("keeps direct settings requests inside the store", () => {
    const files = [...sourceFiles("../src/app"), ...sourceFiles("../src/shared")];
    expect(files.filter((file) => /(?:fetch|requestJSON)\s*\(\s*["'`]\/api\/settings["'`]/.test(readFileSync(file, "utf8")))).toEqual([]);
  });
  it("forwards read abort signals and retains failed write details", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ example: true }) }).mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: "Conflict", code: "stale" }) });
    vi.stubGlobal("fetch", fetchMock);
    await useSettingsStore.getState().fetchSettings({ force: true, signal: controller.signal });
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
    expect(await useSettingsStore.getState().patchSettings({ example: false })).toBeNull();
    expect(useSettingsStore.getState()).toMatchObject({ error: "Conflict", errorStatus: 409, errorBody: { error: "Conflict", code: "stale" }, settings: { example: true } });
  });
  it("saves provider thinking through the shared cache", async () => {
    let settings = { providerThinking: { other: { mode: "low" } } };
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      if (url === "/api/settings") {
        if (options?.method === "PATCH") settings = { ...settings, ...JSON.parse(options.body) };
        return { ok: true, status: 200, json: async () => settings };
      }
      const body = url === "/api/providers" ? { connections: [] } : url === "/api/provider-nodes" ? { nodes: [] } : url.startsWith("/api/proxy-pools") ? { proxyPools: [] } : { providers: {}, models: [], aliases: {}, ids: [] };
      return { ok: true, status: 200, json: async () => body };
    }));
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => { root.render(React.createElement(ProviderDetailPage)); await new Promise((resolve) => setTimeout(resolve, 50)); });
      const select = host.querySelector('[aria-label="Thinking mode"]');
      expect(select).toBeTruthy();
      await act(async () => select.click());
      const option = [...document.querySelectorAll('[role="option"]')].find((node) => node.textContent.includes("Thinking: High"));
      expect(option).toBeTruthy();
      await act(async () => option.click());
      expect(settings.providerThinking).toEqual({ other: { mode: "low" }, openai: { mode: "high" } });
      expect(useSettingsStore.getState().settings.providerThinking).toEqual(settings.providerThinking);
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});

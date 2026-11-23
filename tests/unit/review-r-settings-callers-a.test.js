// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import useSettingsStore from "@/store/settingsStore";
import ClaudeToolCard from "@/app/(dashboard)/dashboard/cli-tools/components/ClaudeToolCard.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const base = "../../src/app/(dashboard)/dashboard/";
const files = ["cli-tools/components/ClaudeToolCard.js", "cli-tools/toolConfiguration.js", "combos/page.js", "endpoint/EndpointPageClient.jsx", "endpoint/ApiKeyModelAccessModal.js", "auto-configure/AutoConfigureClient.js"];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); useSettingsStore.setState({ settings: null, lastFetched: 0, error: null, loading: false }); });
describe("shared settings callers", () => {
  it.each(files)("does not access the settings endpoint directly in %s", (file) => {
    const source = readFileSync(new URL(base + file, import.meta.url), "utf8");
    expect(source).not.toMatch(/["']\/api\/settings["']/);
    if (!file.startsWith("auto-configure")) expect(source).toContain("useSettingsStore");
  });
  it("reads and saves Claude filter naming through the store, and displays save errors", async () => {
    const fetchMock = vi.fn(async (url, options) => {
      if (url === "/api/settings" && options?.method === "PATCH") return { ok: false, json: async () => ({ error: "Save rejected" }) };
      if (url === "/api/settings") return { ok: true, json: async () => ({ ccFilterNaming: true }) };
      return { ok: true, json: async () => ({ aliases: {} }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(React.createElement(ClaudeToolCard, { tool: { name: "Claude", description: "", defaultModels: [] }, baseUrl: "http://localhost:20128", isExpanded: true, initialStatus: { installed: true, settings: { env: {} } }, onToggle: () => {}, onModelMappingChange: () => {}, modelMappings: {}, apiKeys: [], activeProviders: [] })));
    const checkbox = host.querySelector('input[type="checkbox"]');
    expect(checkbox.checked).toBe(true);
    await act(async () => checkbox.click());
    expect(checkbox.checked).toBe(true);
    expect(host.textContent).toContain("Save rejected");
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "PATCH").map(([, options]) => JSON.parse(options.body))).toEqual([{ ccFilterNaming: false }]);
    act(() => root.unmount()); host.remove();
  });
});

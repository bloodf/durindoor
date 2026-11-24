// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "openrouter" }), useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }) }));
vi.mock("motion/react", async (original) => ({ ...await original(), useReducedMotion: () => true }));
import ProviderDetailPage from "../../src/app/(dashboard)/dashboard/providers/[id]/page.js";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root; let host;
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); delete document.documentElement.dataset.ui; vi.unstubAllGlobals(); });
async function flush() { for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); }
describe.each([false, true])("provider detail request preservation with V5 %s", (v5) => {
  it("preserves initial reads and connection and strategy writes", async () => {
    if (v5) document.documentElement.dataset.ui = "v5";
    const calls = [];
    vi.stubGlobal("fetch", vi.fn((url, options = {}) => {
      const path = String(url);
      calls.push({ url: path, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined });
      let data = {};
      if (path === "/api/providers") data = { connections: [{ id: "c1", provider: "openrouter", name: "main", authType: "apikey", isActive: true }] };
      if (path === "/api/provider-nodes") data = { nodes: [] };
      if (path.startsWith("/api/proxy-pools")) data = { proxyPools: [] };
      if (path.startsWith("/api/models/")) data = { ids: [], aliases: {}, models: [], providers: { openrouter: { eligible: false } } };
      if (path === "/api/providers/c1") data = { connection: { id: "c1", provider: "openrouter", name: "main", authType: "apikey", isActive: false } };
      return Promise.resolve({ ok: true, status: 200, json: async () => data });
    }));
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    await act(async () => root.render(React.createElement(ProviderDetailPage))); await flush();
    expect(calls.map(({ url, method }) => [method, url])).toEqual([
      ["GET", "/api/models"], ["GET", "/api/models/custom"], ["GET", "/api/combos"],
      ["GET", "/api/provider-nodes"], ["GET", "/api/providers"], ["GET", "/api/provider-nodes"],
      ["GET", "/api/proxy-pools?isActive=true"], ["GET", "/api/settings"], ["GET", "/api/models/alias"],
      ["GET", "/api/models/custom"], ["GET", "/api/models/disabled?providerAlias=openrouter"],
      ["GET", "/api/models/enabled?providerAlias=openrouter"], ["GET", "/api/providers/openrouter/readiness"],
      ["GET", "/api/providers/openrouter/routing"], ["GET", "/api/models/auto-sync?provider=openrouter"],
    ]);
    const connectionToggle = host.querySelector('[aria-label="Disable main"]'); expect(connectionToggle).toBeTruthy();
    await act(async () => connectionToggle.click()); await flush();
    const strategyToggle = host.querySelector('[aria-label="Toggle round robin"]'); expect(strategyToggle).toBeTruthy();
    await act(async () => strategyToggle.click()); await flush();
    expect(calls.filter((call) => call.method !== "GET")).toEqual([
      { url: "/api/providers/c1", method: "PUT", body: { isActive: false } },
      { url: "/api/settings", method: "PATCH", body: { providerStrategies: { openrouter: { fallbackStrategy: "round-robin", stickyRoundRobinLimit: 1 } } } },
    ]);
  });
});

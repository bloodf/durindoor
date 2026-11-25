// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "openrouter" }), useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }) }));
vi.mock("motion/react", async (original) => ({ ...await original(), useReducedMotion: () => true }));
import ProviderDetailPage from "../../src/app/(dashboard)/dashboard/providers/[id]/page.js";
import ConnectionsCard from "../../src/app/(dashboard)/dashboard/providers/components/ConnectionsCard.js";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root; let host;
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); vi.unstubAllGlobals(); });
async function flush() { for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); }

describe.each([
  ["provider detail", () => React.createElement(ProviderDetailPage)],
  ["connections card", () => React.createElement(ConnectionsCard, { providerId: "openrouter", isOAuth: false })],
])("port(upstream): #3259 - %s sticky input", (_label, element) => {
  it("accepts 0 and saves it unchanged", async () => {
    const writes = [];
    vi.stubGlobal("fetch", vi.fn((url, options = {}) => {
      const path = String(url);
      if (options.method === "PATCH") writes.push(JSON.parse(options.body));
      let data = {};
      if (path === "/api/providers") data = { connections: [{ id: "c1", provider: "openrouter", name: "main", authType: "apikey", isActive: true }] };
      if (path === "/api/provider-nodes") data = { nodes: [] };
      if (path.startsWith("/api/proxy-pools")) data = { proxyPools: [] };
      if (path.startsWith("/api/models/")) data = { ids: [], aliases: {}, models: [], providers: { openrouter: { eligible: false } } };
      if (path === "/api/settings") data = { providerStrategies: { openrouter: { fallbackStrategy: "round-robin", stickyRoundRobinLimit: 2 } } };
      return Promise.resolve({ ok: true, status: 200, json: async () => data });
    }));
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    await act(async () => root.render(element())); await flush();
    const input = [...host.querySelectorAll('input[type="number"]')].find((node) => node.value === "2");
    expect(input).toBeTruthy();
    expect(input.getAttribute("min")).toBe("0");
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    await act(async () => { setValue.call(input, "0"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await flush();
    expect(writes.at(-1)).toEqual({ providerStrategies: { openrouter: { fallbackStrategy: "round-robin", stickyRoundRobinLimit: 0 } } });
  });
});

// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProvidersPage from "../../src/app/(dashboard)/dashboard/providers/page.js";

const ok = (data) => ({ ok: true, json: async () => data });
let host, root;
const flush = () => new Promise((resolve) => setTimeout(resolve, 30));
const render = async () => { await act(async () => { root.render(React.createElement(ProvidersPage)); await flush(); }); };
const click = async (element) => { expect(element).toBeTruthy(); await act(async () => { element.click(); await flush(); }); };
const button = (text) => [...host.querySelectorAll("button")].find((node) => node.textContent.includes(text));

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.documentElement.removeAttribute("data-ui"); vi.unstubAllGlobals(); });

describe.each([false, true])("providers with V5 %s", (v5) => {
  beforeEach(() => { if (v5) document.documentElement.dataset.ui = "v5"; });
  it("shows a load failure and retries the same requests", async () => {
    let fail = true;
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (fail && url === "/api/providers") return { ok: false, status: 503, json: async () => ({}) };
      if (url === "/api/providers") return ok({ connections: [] });
      if (url === "/api/provider-nodes") return ok({ nodes: [] });
      return ok({});
    }));
    await render(); expect(host.querySelector('[role="alert"]')?.textContent).toContain("could not be loaded");
    fail = false; await click(button("Retry"));
    expect(host.textContent).toContain("Providers");
    expect(fetch.mock.calls.filter(([url]) => url === "/api/providers")).toHaveLength(2);
  });
  it("names switches and retains rejected connection state", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      if (options?.method) return { ok: false, status: 503, json: async () => ({}) };
      if (url === "/api/providers") return ok({ connections: [{ id: "a", provider: "openrouter", authType: "apikey", isActive: true }] });
      if (url === "/api/provider-nodes") return ok({ nodes: [] });
      return ok({});
    }));
    await render();
    const toggle = host.querySelector('[role="switch"][aria-label="Disable OpenRouter"]');
    expect(toggle).toBeTruthy(); expect(toggle.tabIndex).toBe(0);
    await click(toggle);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("previous state is retained");
    expect(button("Retry")).toBeTruthy(); expect(toggle.getAttribute("aria-checked")).toBe("true");
  });
  it("shows loading, then an empty filter result", async () => {
    let finish;
    vi.stubGlobal("fetch", vi.fn((url) => url === "/api/providers" ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve(ok(url === "/api/provider-nodes" ? { nodes: [] } : {}))));
    await act(async () => { root.render(React.createElement(ProvidersPage)); await flush(); });
    expect(host.textContent).not.toContain("Manage provider connections");
    await act(async () => { finish(ok({ connections: [] })); await flush(); });
    expect(host.textContent).toContain("No custom providers");
  });
  it("blocks duplicate writes while pending and preserves the request body", async () => {
    let finish;
    vi.stubGlobal("fetch", vi.fn((url, options) => {
      if (options?.method === "PUT") return new Promise((resolve) => { finish = resolve; });
      return Promise.resolve(ok(url === "/api/providers" ? { connections: [{ id: "a", provider: "openrouter", authType: "apikey", isActive: true }] } : url === "/api/provider-nodes" ? { nodes: [] } : {}));
    }));
    await render();
    const toggle = host.querySelector('[role="switch"][aria-label="Disable OpenRouter"]');
    await click(toggle); expect(toggle.disabled).toBe(true);
    await click(toggle);
    const writes = fetch.mock.calls.filter(([, options]) => options?.method === "PUT");
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toBe("/api/providers/a");
    expect(JSON.parse(writes[0][1].body)).toEqual({ isActive: false });
    await act(async () => { finish({ ok: false, status: 503, json: async () => ({}) }); await flush(); });
    expect(toggle.disabled).toBe(false);
  });
  it.each(["malformed", "network"])("offers retry after %s response", async (failure) => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (url === "/api/providers") {
        if (failure === "network") throw new Error("offline");
        return ok({});
      }
      return ok(url === "/api/provider-nodes" ? { nodes: [] } : {});
    }));
    await render(); expect(host.querySelector('[role="alert"]')).toBeTruthy(); expect(button("Retry")).toBeTruthy();
  });

});

// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ id: "openrouter" }));
vi.mock("next/navigation", () => ({ useParams: () => route, useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));
vi.mock("@/shared/constants/models", async (importOriginal) => ({
  ...await importOriginal(),
  getModelsByProviderId: () => [{ id: "shared-model", name: "Shared" }],
}));
import ProviderDetailPage from "../../src/app/(dashboard)/dashboard/providers/[id]/page.js";

const response = (data) => ({ ok: true, json: async () => data });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

let host, root, pending;
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); }); };
const render = async (id) => {
  route.id = id;
  await act(async () => { root.render(React.createElement(ProviderDetailPage)); });
  await flush();
};
const click = async (button) => {
  expect(button).toBeTruthy();
  await act(async () => { button.click(); });
};

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  pending = deferred();
  vi.stubGlobal("fetch", vi.fn((url, options) => {
    const path = String(url);
    if (path.includes("/models?refresh=1") || (path === "/api/models/test" && options?.method === "POST")) return pending.promise;
    if (path === "/api/providers") return Promise.resolve(response({ connections: ["openrouter", "siliconflow"].map((provider) => ({ id: provider, provider, name: provider, authType: "apikey", isActive: true })) }));
    if (path === "/api/provider-nodes") return Promise.resolve(response({ nodes: [] }));
    if (path.startsWith("/api/proxy-pools")) return Promise.resolve(response({ proxyPools: [] }));
    if (path.startsWith("/api/models/auto-sync")) return Promise.resolve(response({ providers: {} }));
    if (path.startsWith("/api/models/custom")) return Promise.resolve(response({ models: [] }));
    if (path.startsWith("/api/models/alias")) return Promise.resolve(response({ aliases: {} }));
    if (path.startsWith("/api/models/disabled") || path.startsWith("/api/models/enabled")) return Promise.resolve(response({ ids: [] }));
    return Promise.resolve(response({}));
  }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("provider switch while evidence is pending", () => {
  it("does not show a previous provider's catalog evidence", async () => {
    await render("openrouter");
    await click([...host.querySelectorAll("button")].find((button) => button.textContent.includes("Sync models")));
    await render("siliconflow");
    await act(async () => { pending.resolve(response({ models: [], source: "previous-provider", degraded: true })); await pending.promise; });
    expect(host.textContent).not.toContain("previous-provider");
  });

  it("does not assign the previous provider's inference to the same model ID", async () => {
    await render("openrouter");
    await click(host.querySelector('button[aria-label="Test model"]'));
    await render("siliconflow");
    await act(async () => { pending.resolve(response({ ok: true })); await pending.promise; });
    expect(host.textContent).not.toContain("Inference passed in this session");
    expect(host.textContent).toContain("Inference not tested");
  });
});

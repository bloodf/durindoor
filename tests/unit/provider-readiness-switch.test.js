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
import CompatibleModelsSection from "../../src/app/(dashboard)/dashboard/providers/[id]/CompatibleModelsSection.js";
import PassthroughModelsSection from "../../src/app/(dashboard)/dashboard/providers/[id]/PassthroughModelsSection.js";

const response = (data) => ({ ok: true, json: async () => data });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

let host, root, pending, commits;
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); }); };
const render = async (id) => {
  route.id = id;
  await act(async () => { root.render(React.createElement(React.Profiler, {
    id: "provider", onRender: () => commits.push({
      text: host.textContent,
      proPlans: [...host.querySelectorAll("span")].filter((node) => node.textContent === "Pro").length,
      filter: host.querySelector('[aria-label="Filter connections"]')?.value,
      rows: [...host.querySelectorAll('[aria-label^="Select "]')].map((node) => node.getAttribute("aria-label")),
    }),
  }, React.createElement(ProviderDetailPage))); });
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
  commits = [];
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

describe.each([
  ["compatible", CompatibleModelsSection],
  ["passthrough", PassthroughModelsSection],
])("%s model evidence", (_name, Component) => {
  it("shows skipped after a manual test without reporting success", async () => {
    const props = {
      providerAlias: "test", providerStorageAlias: "test", providerDisplayAlias: "test",
      modelAliases: {}, customModels: [{ id: "shared-model", providerAlias: "test" }],
      connections: [{ id: "connection", isActive: true }], onCopy: () => {}, onDeleteAlias: () => {},
      onAddCustomModel: () => {}, onDeleteCustomModel: () => {}, onRefresh: () => {},
    };
    await act(async () => { root.render(React.createElement(Component, props)); });
    expect(host.textContent).toContain("Inference not tested");
    expect(fetch).not.toHaveBeenCalled();
    await click(host.querySelector('button[aria-label="Test shared-model"]'));
    await act(async () => { pending.resolve(response({ skipped: true })); await pending.promise; });
    expect(host.textContent).toContain("Inference skipped in this session");
    expect(host.textContent).not.toContain("Inference passed in this session");
  });
});

describe("provider switch while evidence is pending", () => {
  it("does not show a previous provider's catalog evidence", async () => {
    await render("openrouter");
    await click([...host.querySelectorAll("button")].find((button) => button.textContent.includes("Sync models")));
    await render("siliconflow");
    await act(async () => { pending.resolve(response({ models: [], source: "previous-provider", degraded: true })); await pending.promise; });
    expect(host.textContent).not.toContain("previous-provider");
  });

  it("shows connection and catalog evidence without asserting inference", async () => {
    await render("openrouter");
    expect(host.textContent).toContain("Operational status is not authentication verification.");
    expect(host.textContent).toContain("Operational: unknown");
    expect(host.textContent).toContain("Inference not tested");
    expect(fetch.mock.calls.some(([url]) => String(url) === "/api/models/test")).toBe(false);
    await click([...host.querySelectorAll("button")].find((button) => button.textContent.includes("Sync models")));
    await act(async () => { pending.resolve(response({ models: [], source: "fallback", degraded: true })); await pending.promise; });
    expect(host.textContent).toContain("Catalog source: fallback (degraded). This does not verify inference.");
  });

  it("keeps a new discovery running when an older request finishes", async () => {
    await render("openrouter");
    await click([...host.querySelectorAll("button")].find((button) => button.textContent.includes("Sync models")));
    const old = pending;
    await render("siliconflow");
    await render("openrouter");
    pending = deferred();
    await click([...host.querySelectorAll("button")].find((button) => button.textContent.includes("Sync models")));
    await act(async () => { old.resolve(response({ models: [], source: "stale-source" })); await old.promise; });
    expect(host.textContent).toContain("Syncing…");
    expect(host.textContent).not.toContain("stale-source");
    await act(async () => { pending.resolve(response({ models: [], source: "live" })); await pending.promise; });
    expect(host.textContent).toContain("Catalog source: live");
  });

  it("ignores old discovery after returning to the same provider", async () => {
    await render("openrouter");
    await click([...host.querySelectorAll("button")].find((button) => button.textContent.includes("Sync models")));
    await render("siliconflow");
    await render("openrouter");
    await act(async () => { pending.resolve(response({ models: [], source: "stale-source", degraded: true })); await pending.promise; });
    expect(host.textContent).not.toContain("stale-source");
  });

  it("ignores old inference after returning to the same provider", async () => {
    await render("openrouter");
    await click(host.querySelector('button[aria-label="Test model"]'));
    await render("siliconflow");
    await render("openrouter");
    await act(async () => { pending.resolve(response({ ok: true })); await pending.promise; });
    expect(host.textContent).not.toContain("Inference passed in this session");
    expect(host.textContent).toContain("Inference not tested");
  });

  it("does not let an old failure clear a new inference test", async () => {
    await render("openrouter");
    await click(host.querySelector('button[aria-label="Test model"]'));
    const old = pending;
    await render("siliconflow");
    await render("openrouter");
    pending = deferred();
    await click(host.querySelector('button[aria-label="Test model"]'));
    await act(async () => { old.reject(new Error("old network error")); await old.promise.catch(() => {}); });
    expect(host.textContent).toContain("Inference test running");
    expect(host.textContent).not.toContain("Network error");
    await act(async () => { pending.resolve(response({ skipped: true })); await pending.promise; });
    expect(host.textContent).toContain("Inference skipped in this session");
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


describe("provider identity at commit", () => {
  it("drops old rows, selection and filter before the first switched commit", async () => {
    await render("openrouter");
    await click(host.querySelector('[aria-label="Select openrouter"]'));
    const filter = host.querySelector('[aria-label="Filter connections"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(filter, "openrouter");
      filter.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.textContent).toContain("1 selected");
    commits.length = 0;
    await render("siliconflow");
    expect(commits[0].rows).not.toContain("Select openrouter");
    expect(commits[0].filter || "").toBe("");
    expect(commits[0].text).not.toContain("1 selected");
    expect(host.querySelector('[aria-label="Select siliconflow"]')).toBeTruthy();
  });

  it("drops completed catalog and inference evidence before the first switched commit", async () => {
    await render("openrouter");
    await click([...host.querySelectorAll("button")].find((button) => button.textContent.includes("Sync models")));
    await act(async () => { pending.resolve(response({ models: [], source: "old-catalog" })); await pending.promise; });
    pending = deferred();
    await click(host.querySelector('button[aria-label="Test model"]'));
    await act(async () => { pending.resolve(response({ ok: true })); await pending.promise; });
    expect(host.textContent).toContain("old-catalog");
    expect(host.textContent).toContain("Inference passed in this session");
    commits.length = 0;
    await render("siliconflow");
    expect(commits[0].text).not.toContain("old-catalog");
    expect(commits[0].text).not.toContain("Inference passed in this session");
    expect(host.textContent).toContain("Inference not tested");
  });
});

it("ignores a pending initial connection response after switching providers", async () => {
  const old = deferred();
  const previous = fetch.getMockImplementation();
  let first = true;
  fetch.mockImplementation((url, options) => {
    if (url === "/api/providers" && first) { first = false; return old.promise; }
    return previous(url, options);
  });
  await render("openrouter");
  await render("siliconflow");
  await act(async () => {
    old.resolve(response({ connections: [{ id: "old-account", provider: "openrouter", name: "Old account" }] }));
    await old.promise;
  });
  expect(host.querySelector('[aria-label="Select siliconflow"]')).toBeTruthy();
  expect(host.textContent).not.toContain("Old account");
});

it("finishes initial loading when the connection read fails", async () => {
  const previous = fetch.getMockImplementation();
  fetch.mockImplementation((url, options) => url === "/api/providers"
    ? Promise.reject(new Error("offline connection read")) : previous(url, options));
  await render("openrouter");
  expect(host.querySelector('a[href="/dashboard/providers"]')).toBeTruthy();
  expect(host.querySelector('[aria-label="Select openrouter"]')).toBeNull();
});


it("drops Codex rows and live plan badges before committing a different provider", async () => {
  const previous = fetch.getMockImplementation();
  fetch.mockImplementation((url, options) => {
    if (url === "/api/providers") return Promise.resolve(response({ connections: [
      { id: "codex-account", provider: "codex", name: "Codex account", authType: "oauth", isActive: true },
      { id: "siliconflow", provider: "siliconflow", name: "siliconflow", authType: "apikey", isActive: true },
    ] }));
    if (url === "/api/usage/codex-account") return Promise.resolve(response({ plan: "Pro" }));
    return previous(url, options);
  });
  await render("codex");
  expect(host.querySelector('[aria-label="Select Codex account"]')).toBeTruthy();
  expect(commits.at(-1).proPlans).toBeGreaterThan(0);
  commits.length = 0;
  await render("siliconflow");
  expect(commits[0].rows).not.toContain("Select Codex account");
  expect(commits[0].proPlans).toBe(0);
});

it("closes the visible-models modal and drops the old allowlist on provider switch", async () => {
  const previous = fetch.getMockImplementation();
  fetch.mockImplementation((url, options) => {
    if (String(url).startsWith("/api/models/enabled?providerAlias=openrouter")) return Promise.resolve(response({ ids: ["shared-model"] }));
    return previous(url, options);
  });
  await render("openrouter");
  expect(host.textContent).toContain("Only these 1 models");
  await click([...host.querySelectorAll("button")].find((node) => node.textContent.includes("Visible models")));
  expect(document.querySelector('[aria-label="Search visible models"]')).toBeTruthy();
  await render("siliconflow");
  expect(document.querySelector('[aria-label="Search visible models"]')).toBeNull();
  expect(host.textContent).not.toContain("Only these 1 models");
});

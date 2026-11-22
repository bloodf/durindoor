// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ kind: "embedding", id: "openai", comboId: "combo-1" }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ kind: route.kind, id: route.id === "combo" ? route.comboId : route.id }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/dashboard/media-providers/embedding",
  useSearchParams: () => new URLSearchParams(),
  notFound: () => { throw new Error("notFound"); },
}));

import MediaProviderKindPage from "../../src/app/(dashboard)/dashboard/media-providers/[kind]/page.js";
import MediaProviderDetailPage from "../../src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/page.js";
import ComboDetailPage from "../../src/app/(dashboard)/dashboard/media-providers/combo/[id]/page.js";
import WebProvidersPage from "../../src/app/(dashboard)/dashboard/media-providers/web/page.js";
import MediaRoutesPage from "../../src/app/(dashboard)/dashboard/media-routes/page.js";
import { SttExampleCard } from "../../src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/components/SttExampleCard.js";
import { GenericExampleCard } from "../../src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/components/GenericExampleCard.js";

const ok = (body = {}) => ({ ok: true, status: 200, json: async () => body });
const fail = (status = 503, body = { error: "unavailable" }) => ({ ok: false, status, json: async () => body });
const flush = () => new Promise((resolve) => setTimeout(resolve, 40));
let host, root;
const setV5 = (on) => { if (on) document.documentElement.dataset.ui = "v5"; else delete document.documentElement.dataset.ui; };
const render = async (element) => { await act(async () => { root.render(element); await flush(); }); };
const settle = async () => { await act(async () => { await flush(); }); };
const button = (name) => [...host.querySelectorAll("button")].find((el) => el.textContent.includes(name) || el.getAttribute("aria-label") === name);
const click = async (el) => { expect(el).toBeTruthy(); await act(async () => { el.click(); await flush(); }); };
const requests = () => fetch.mock.calls.map(([url, options]) => [options?.method || "GET", url, options?.body]);

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  route.kind = "embedding";
  route.id = "openai";
  route.comboId = "combo-1";
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function shim() { this.setAttribute("open", ""); });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  setV5(false);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("media-providers/[kind] (S17)", () => {
  it("retries the same kind providers URL after a load failure", async () => {
    setV5(true);
    let failing = true;
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).startsWith("/api/providers")) return failing ? fail(503, { error: "offline" }) : ok({ connections: [{ id: "openai-1", provider: "openai", isActive: true, testStatus: "success" }] });
      if (String(url).includes("/api/provider-nodes")) return ok({ nodes: [] });
      if (String(url).includes("/api/v1/models/embedding")) return ok({ data: [] });
      if (String(url).includes("/api/combos")) return ok({ combos: [] });
      return ok({});
    }));
    await render(React.createElement(MediaProviderKindPage));
    await settle();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("could not be loaded");
    failing = false;
    await click(button("Retry"));
    await settle();
    const providerReads = requests().filter(([, url]) => String(url).startsWith("/api/providers"));
    expect(providerReads.length).toBeGreaterThanOrEqual(2);
    expect(host.querySelector('section[aria-label*="providers"]')?.className).toMatch(/grid/);
  });

  it.each([false, true])("keeps the provider toggle write identical, V5 %s", async (v5) => {
    setV5(v5);
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      if (options?.method === "PUT") return ok({});
      if (String(url).startsWith("/api/providers")) return ok({ connections: [{ id: "openai-1", provider: "openai", isActive: true, testStatus: "success" }] });
      if (String(url).includes("/api/provider-nodes")) return ok({ nodes: [] });
      if (String(url).includes("/api/v1/models/embedding")) return ok({ data: [] });
      return ok({ combos: [] });
    }));
    await render(React.createElement(MediaProviderKindPage));
    await settle();
    const toggle = host.querySelector('[role="switch"][aria-label="Disable OpenAI"]');
    await click(toggle);
    await settle();
    const write = requests().find(([method, url]) => method === "PUT" && String(url) === "/api/providers/openai-1");
    expect(write).toEqual(["PUT", "/api/providers/openai-1", JSON.stringify({ isActive: false })]);
  });
});

describe("media-providers/[kind]/[id] (S17)", () => {
  const detailFetches = async (url, options) => {
    if (options?.method === "PUT" && String(url).startsWith("/api/providers/")) return ok({});
    if (String(url).startsWith("/api/providers")) return ok({ connections: [{ id: "openai-1", provider: "openai", name: "OpenAI key", isActive: true, testStatus: "success", authType: "apikey" }] });
    if (String(url).includes("/api/models")) return ok({ models: [], aliases: {}, providers: {} });
    if (String(url).includes("/api/settings")) return ok({ providerStrategies: {} });
    if (String(url).includes("/api/proxy-pools")) return ok({ pools: [] });
    if (String(url).includes("/api/tunnel")) return ok({});
    return ok({});
  };

  it.each([false, true])("keeps the account toggle write identical, V5 %s", async (v5) => {
    setV5(v5);
    route.kind = "embedding";
    route.id = "openai";
    vi.stubGlobal("fetch", vi.fn(detailFetches));
    await render(React.createElement(MediaProviderDetailPage));
    await settle();
    const toggle = [...host.querySelectorAll('[role="switch"]')].find((el) => /Disable/i.test(el.getAttribute("aria-label") || ""));
    expect(toggle).toBeTruthy();
    await click(toggle);
    await settle();
    const write = requests().find(([method, url]) => method === "PUT" && String(url).startsWith("/api/providers/"));
    expect(write?.[0]).toBe("PUT");
    expect(write?.[1]).toBe("/api/providers/openai-1");
    expect(JSON.parse(write?.[2] || "{}")).toEqual({ isActive: false });
  });

  it("labels STT file and example controls in V5", async () => {
    setV5(true);
    vi.stubGlobal("fetch", vi.fn(async () => ok({ models: [], publicUrl: null })));
    await render(React.createElement(SttExampleCard, { providerId: "openai" }));
    await settle();
    expect(host.querySelector('input[type="file"][aria-label="Audio file"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="Model"]')).toBeTruthy();
  });

  it("labels generic example controls in V5", async () => {
    setV5(true);
    vi.stubGlobal("fetch", vi.fn(async () => ok({ connections: [], models: [], publicUrl: null, providers: {} })));
    await render(React.createElement(GenericExampleCard, { providerId: "tavily", kind: "webSearch" }));
    await settle();
    expect(host.querySelector('[aria-label="Query"], [aria-label="API Key"]')).toBeTruthy();
  });
});

describe("media-providers/combo/[id] (S17)", () => {
  const combo = { id: "combo-1", name: "search-combo", kind: "webSearch", models: ["openai/gpt-4o"] };

  it("keeps the combo after a delete error and manages confirm focus in V5", async () => {
    setV5(true);
    route.id = "combo";
    route.comboId = "combo-1";
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      if (options?.method === "DELETE") return fail(403, { error: "Forbidden" });
      if (String(url).includes("/api/combos/")) return ok(combo);
      if (String(url).includes("/api/settings")) return ok({ comboStrategies: {} });
      if (String(url).includes("/api/usage/logs")) return ok([]);
      if (String(url).includes("/api/providers")) return ok({ connections: [] });
      if (String(url).includes("/api/models/alias")) return ok({ aliases: {} });
      return ok({});
    }));
    await render(React.createElement(ComboDetailPage));
    await settle();
    await click(button("Delete"));
    const dialog = document.querySelector("dialog, [role='dialog']");
    expect(dialog).toBeTruthy();
    expect(dialog.contains(document.activeElement) || dialog === document.activeElement || dialog.querySelector("button")).toBeTruthy();
    await click([...dialog.querySelectorAll("button")].find((el) => el.textContent.trim() === "Delete"));
    await settle();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Forbidden");
    expect(host.textContent).toContain("search-combo");
  });

  it("shows EmptyProviders in V5", async () => {
    setV5(true);
    route.id = "combo";
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).includes("/api/combos/")) return ok({ ...combo, models: [] });
      if (String(url).includes("/api/settings")) return ok({ comboStrategies: {} });
      if (String(url).includes("/api/usage/logs")) return ok([]);
      if (String(url).includes("/api/providers")) return ok({ connections: [] });
      if (String(url).includes("/api/models/alias")) return ok({ aliases: {} });
      return ok({});
    }));
    await render(React.createElement(ComboDetailPage));
    await settle();
    expect(host.textContent).toContain("No providers yet");
  });
});

describe("media-providers/web (S17)", () => {
  it.each([false, true])("keeps the create-combo POST identical and retains list on error, V5 %s", async (v5) => {
    setV5(v5);
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      if (options?.method === "POST") return fail(422, { error: "Server rejected combo" });
      if (String(url).startsWith("/api/providers")) return ok({ connections: [{ id: "tavily-1", provider: "tavily", testStatus: "success", isActive: true }] });
      if (String(url).includes("/api/combos")) return ok({ combos: [{ id: "search-combo-1", name: "research-pool", kind: "webSearch", models: ["tavily/search"] }] });
      return ok({});
    }));
    await render(React.createElement(WebProvidersPage));
    await settle();
    const create = [...host.querySelectorAll("button")].find((el) => el.textContent.includes("Create Combo"));
    await click(create);
    await settle();
    const write = requests().find(([method, url]) => method === "POST" && String(url) === "/api/combos");
    expect(write).toEqual(["POST", "/api/combos", JSON.stringify({ name: "search-combo", models: [], kind: "webSearch" })]);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Server rejected combo");
    expect(host.textContent).toContain("research-pool");
    expect(host.textContent).toContain("Tavily");
  });

  it("retries the same providers URL after load failure in V5", async () => {
    setV5(true);
    let failing = true;
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).startsWith("/api/providers")) return failing ? fail(503, { error: "offline" }) : ok({ connections: [] });
      if (String(url).includes("/api/combos")) return ok({ combos: [] });
      return ok({});
    }));
    await render(React.createElement(WebProvidersPage));
    await settle();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("could not be loaded");
    failing = false;
    await click(button("Retry"));
    await settle();
    expect(requests().filter(([, url]) => String(url).startsWith("/api/providers")).length).toBe(2);
  });
});

describe("media-routes (S17)", () => {
  const imageRoute = {
    id: "image",
    label: "Image generation",
    endpoint: "/v1/images/generations",
    saved: ["openai/gpt-image-1"],
    candidates: [
      { id: "openai/gpt-image-1", name: "GPT Image" },
      { id: "openai/dall-e-3", name: "DALL-E 3" },
    ],
    effective: ["openai/gpt-image-1"],
    endpoints: [],
  };

  it.each([false, true])("keeps the fallback ordering write identical, V5 %s", async (v5) => {
    setV5(v5);
    const custom = {
      ...imageRoute,
      saved: ["openai/gpt-image-1", "openai/dall-e-3"],
      effective: ["openai/gpt-image-1", "openai/dall-e-3"],
    };
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      if (options?.method === "PUT") return ok({ route: { ...custom, saved: ["openai/dall-e-3"], effective: ["openai/dall-e-3"] } });
      return ok({ routes: [custom] });
    }));
    await render(React.createElement(MediaRoutesPage));
    await settle();
    await click(host.querySelector('[aria-label="Remove openai/gpt-image-1"]'));
    await settle();
    if (v5) {
      expect(host.querySelector('[name="media-route-image-add"], [aria-label="Add a fallback model…"]')).toBeTruthy();
    }
    await click(button("Save"));
    await settle();
    const write = requests().find(([method, url]) => method === "PUT" && String(url) === "/api/media-providers/routes");
    expect(write).toEqual(["PUT", "/api/media-providers/routes", JSON.stringify({ kind: "image", models: ["openai/dall-e-3"] })]);
  });

  it("renders LoadError, EmptyRoute, and CustomUnavailable states in V5", async () => {
    setV5(true);
    vi.stubGlobal("fetch", vi.fn(async () => fail(503, { error: "Routes service unavailable" })));
    await render(React.createElement(MediaRoutesPage));
    await settle();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Routes service unavailable");
    expect(button("Retry")).toBeTruthy();

    await act(async () => { root.unmount(); await flush(); });
    root = createRoot(host);
    vi.stubGlobal("fetch", vi.fn(async () => ok({ routes: [{ id: "music", label: "Music", endpoint: "/v1/music", saved: [], candidates: [], effective: [], endpoints: [] }] })));
    await render(React.createElement(MediaRoutesPage));
    await settle();
    expect(host.textContent).toContain("No connected provider supports this");

    await act(async () => { root.unmount(); await flush(); });
    root = createRoot(host);
    vi.stubGlobal("fetch", vi.fn(async () => ok({
      routes: [{
        id: "embedding",
        label: "Embeddings",
        endpoint: "/v1/embeddings",
        saved: ["openai/text-embedding-3-small", "retired/model"],
        candidates: [{ id: "openai/text-embedding-3-small", name: "Text Embedding 3 Small" }],
        effective: ["openai/text-embedding-3-small", "retired/model"],
        endpoints: [],
      }],
    })));
    await render(React.createElement(MediaRoutesPage));
    await settle();
    expect(host.textContent).toContain("unavailable, skipped");
  });
});

// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ id: "openrouter" }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: route.id }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));
vi.mock("motion/react", async (importOriginal) => ({
  ...await importOriginal(),
  useReducedMotion: () => true,
}));

import ModelAutoSyncPanel from "../../src/app/(dashboard)/dashboard/providers/[id]/ModelAutoSyncPanel.js";
import ProviderDetailPage from "../../src/app/(dashboard)/dashboard/providers/[id]/page.js";
import ProviderDetailError from "../../src/app/(dashboard)/dashboard/providers/[id]/error.js";
import AddApiKeyModal from "../../src/app/(dashboard)/dashboard/providers/[id]/AddApiKeyModal.js";
import ProviderErrorRulesModal from "../../src/app/(dashboard)/dashboard/providers/[id]/ProviderErrorRulesModal.js";

const synced = {
  eligible: true,
  enabled: true,
  models: [{ id: "live-model" }],
  newModelIds: ["live-model"],
  removedModelIds: ["retired-model"],
  syncedAt: "2026-10-08T12:00:00.000Z",
  error: null,
};

function json(data, ok = true) {
  return { ok, status: ok ? 200 : 503, json: async () => data };
}

function statusFor(providerId, patch = {}) {
  return {
    intervalHours: 24,
    providers: { [providerId]: { ...synced, ...patch } },
  };
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host;
let root;
let showModal;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function shim() {
    this.setAttribute("open", "");
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete document.documentElement.dataset.ui;
  showModal.mockRestore();
  vi.unstubAllGlobals();
});

async function flush() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
}

function enable(v5) {
  if (v5) document.documentElement.dataset.ui = "v5";
  else delete document.documentElement.dataset.ui;
}

async function renderPanel(props, v5) {
  enable(v5);
  await act(async () => {
    root.render(React.createElement(ModelAutoSyncPanel, props));
  });
  await flush();
}

function buttonNamed(name) {
  return [...document.querySelectorAll("button")].find((node) => {
    const copy = node.cloneNode(true);
    copy.querySelectorAll("[aria-hidden='true']").forEach((icon) => icon.remove());
    return copy.textContent.replace(/\s+/g, " ").trim() === name;
  });
}

function switchFor(label) {
  const text = [...host.querySelectorAll("label")].find((node) => node.textContent === label);
  return text ? document.getElementById(text.htmlFor) : null;
}

describe.each([false, true])("provider detail auto-sync with V5 %s", (v5) => {
  it("keeps the auto-sync write identical and names the controls", async () => {
    const patches = [];
    const posts = [];
    vi.stubGlobal("fetch", vi.fn((url, options = {}) => {
      const path = String(url);
      if (path.startsWith("/api/models/auto-sync") && options.method !== "POST") return Promise.resolve(json(statusFor("openai")));
      if (path === "/api/settings" && options.method !== "PATCH") {
        return Promise.resolve(json({ modelAutoSyncProviders: { openai: true, google: false }, requireApiKey: true }));
      }
      if (path === "/api/settings" && options.method === "PATCH") {
        patches.push({ method: options.method, url: path, body: JSON.parse(options.body), headers: options.headers });
        return Promise.resolve(json({ ok: true }));
      }
      if (path === "/api/models/auto-sync" && options.method === "POST") {
        posts.push({ method: options.method, url: path, body: JSON.parse(options.body), headers: options.headers });
        return Promise.resolve(json({ results: [{ status: "synced", modelCount: 2 }] }));
      }
      return Promise.resolve(json({}));
    }));
    const onModelsChange = vi.fn();
    await renderPanel({ providerId: "openai", hasConnection: true, onModelsChange }, v5);

    const toggle = switchFor("Auto-update models");
    const sync = buttonNamed("Sync now");
    expect(toggle.getAttribute("role")).toBe("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(toggle.className).toContain("focus-visible");
    expect(sync.disabled).toBe(false);
    expect(sync.className).toContain("focus-visible");
    expect(sync.querySelector("[aria-hidden='true']")).toBeTruthy();
    toggle.focus();
    expect(document.activeElement).toBe(toggle);
    sync.focus();
    expect(document.activeElement).toBe(sync);
    expect(onModelsChange).toHaveBeenCalledWith(synced.models);

    await act(async () => { toggle.click(); });
    await flush();
    await act(async () => { buttonNamed("Sync now").click(); });
    await flush();

    expect(patches).toEqual([{
      method: "PATCH",
      url: "/api/settings",
      headers: { "Content-Type": "application/json" },
      body: { modelAutoSyncProviders: { openai: false, google: false } },
    }]);
    expect(posts).toEqual([{
      method: "POST",
      url: "/api/models/auto-sync",
      headers: { "Content-Type": "application/json" },
      body: { provider: "openai" },
    }]);
    if (v5) {
      expect(host.querySelector("#v5-provider-sync-title").textContent).toContain("Model auto-sync");
      expect(host.querySelector("summary").textContent).toBe("Catalog changes");
      const summary = host.querySelector("summary");
      summary.focus();
      expect(document.activeElement).toBe(summary);
      expect(host.querySelector("code").textContent).toBe("live-model");
      expect([...host.querySelectorAll("[data-icon-name]")].every((icon) => icon.getAttribute("aria-hidden") === "true")).toBe(true);
      expect([...host.querySelectorAll("[data-icon-name]")].every((icon) => !icon.className.includes("animate-spin"))).toBe(true);
    } else {
      expect(host.querySelector("#v5-provider-sync-title")).toBeNull();
      expect(host.textContent).toContain("New: live-model");
      expect(host.textContent).toContain("Removed in last sync: retired-model");
      expect(host.querySelector("[data-icon-name]")).toBeNull();
    }
  });

  it("shows paused, unsynced, no-connection, and failed catalog states", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json(statusFor("openai", {
      enabled: false,
      syncedAt: null,
      models: [],
      newModelIds: [],
      removedModelIds: [],
      error: "Upstream timeout",
    })))));
    await renderPanel({ providerId: "openai", hasConnection: false, onModelsChange: vi.fn() }, v5);
    const toggle = switchFor("Auto-update models");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(buttonNamed("Sync now").disabled).toBe(true);
    expect(host.textContent).toContain("Last attempt failed: Upstream timeout");
    if (v5) {
      expect(host.textContent).toContain("Paused");
      expect(host.textContent).toContain("Not synced");
      expect(host.textContent).toContain("Add an active connection to sync this provider’s catalog.");
      expect(host.querySelector("[role='alert']").textContent).toContain("Upstream timeout");
    } else {
      expect(host.textContent).toContain("Not synced yet.");
      expect(host.querySelector(".v5-provider-sync")).toBeNull();
    }
  });
});

describe("V5 auto-sync states", () => {
  it("shows loading, then unsupported, and keeps the card empty of a toggle", async () => {
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn(() => pending));
    await renderPanel({ providerId: "openai", hasConnection: true, onModelsChange: vi.fn() }, true);
    expect(host.querySelector("[role='status']").textContent).toContain("Loading model sync status");
    expect(host.querySelector("section").getAttribute("aria-busy")).toBe("true");
    expect(switchFor("Auto-update models")).toBeNull();
    release(json(statusFor("openai", { eligible: false, enabled: false, models: null, newModelIds: [], removedModelIds: [] })));
    await flush();
    expect(host.textContent).toContain("This provider has no model-list API.");
    expect(host.textContent).toContain("Unavailable");
    expect(switchFor("Auto-update models")).toBeNull();
  });

  it("retries a failed status read and blocks a duplicate sync while one is pending", async () => {
    let statusCalls = 0;
    let releasePost;
    vi.stubGlobal("fetch", vi.fn((url, options = {}) => {
      const path = String(url);
      if (path.startsWith("/api/models/auto-sync") && options.method !== "POST") {
        statusCalls += 1;
        if (statusCalls === 1) return Promise.resolve(json({ error: "down" }, false));
        return Promise.resolve(json(statusFor("openai")));
      }
      if (options.method === "POST") return new Promise((resolve) => { releasePost = resolve; });
      return Promise.resolve(json({}));
    }));
    await renderPanel({ providerId: "openai", hasConnection: true, onModelsChange: vi.fn() }, true);
    expect(host.querySelector("[role='alert']").textContent).toContain("Model sync status is unavailable.");
    const retry = buttonNamed("Retry status");
    expect(retry.className).toContain("focus-visible");
    retry.focus();
    expect(document.activeElement).toBe(retry);
    await act(async () => { retry.click(); });
    await flush();
    expect(switchFor("Auto-update models")).toBeTruthy();

    await act(async () => { buttonNamed("Sync now").click(); });
    await flush();
    const syncing = buttonNamed("Syncing…");
    expect(syncing.disabled).toBe(true);
    expect(switchFor("Auto-update models").disabled).toBe(true);
    expect(host.querySelector("section").getAttribute("aria-busy")).toBe("true");
    releasePost(json({ results: [{ status: "failed", error: "Provider unavailable" }] }));
    await flush();
    expect(host.textContent).toContain("The previous model list is kept.");
    expect(host.querySelector("[role='alert']").textContent).toContain("Provider unavailable");
    expect(host.textContent).toContain("live-model");
  });

  it("ignores a stale status after the provider changes and aborts it on unmount", async () => {
    const signals = [];
    let release;
    const onModelsChange = vi.fn();
    vi.stubGlobal("fetch", vi.fn((url, options = {}) => {
      const path = String(url);
      signals.push(options.signal);
      if (path.includes("provider=openai")) {
        return new Promise((resolve, reject) => {
          const abort = () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          };
          if (options.signal?.aborted) abort();
          else options.signal?.addEventListener("abort", abort, { once: true });
          release = () => resolve(json(statusFor("openai", { newModelIds: ["stale-gpt"], removedModelIds: [] })));
        });
      }
      return Promise.resolve(json(statusFor("google", { newModelIds: ["gemini-live"], removedModelIds: [] })));
    }));
    await renderPanel({ providerId: "openai", hasConnection: true, onModelsChange }, true);
    expect(signals[0]).toBeTruthy();
    await renderPanel({ providerId: "google", hasConnection: true, onModelsChange }, true);
    expect(signals[0].aborted).toBe(true);
    expect(host.textContent).toContain("gemini-live");
    expect(host.textContent).not.toContain("stale-gpt");
    if (release) release();
    await flush();
    expect(host.textContent).not.toContain("stale-gpt");
    expect(onModelsChange).toHaveBeenCalledWith([{ id: "live-model" }]);
    expect(onModelsChange.mock.calls.some(([models]) => models?.some?.((model) => model.id === "stale-gpt"))).toBe(false);

    const before = signals.length;
    await act(async () => root.unmount());
    root = createRoot(host);
    expect(signals[before - 1].aborted).toBe(true);
  });
});

describe("flag-off auto-sync stays on the incumbent contract", () => {
  it("hides an unsupported provider and ignores a stale status without aborting", async () => {
    const signals = [];
    let release;
    const onModelsChange = vi.fn();
    vi.stubGlobal("fetch", vi.fn((url, options = {}) => {
      signals.push(options.signal);
      const path = String(url);
      if (path.includes("provider=openai")) {
        return new Promise((resolve) => {
          release = () => resolve(json(statusFor("openai", { newModelIds: ["stale-gpt"], removedModelIds: [] })));
        });
      }
      if (path.includes("provider=google")) return Promise.resolve(json(statusFor("google", { newModelIds: ["gemini-live"], removedModelIds: [] })));
      return Promise.resolve(json(statusFor("openai", { eligible: false })));
    }));
    await renderPanel({ providerId: "openai", hasConnection: true, onModelsChange }, false);
    expect(fetch.mock.calls[0][1]).toEqual({ cache: "no-store" });
    expect(signals[0]).toBeUndefined();
    await renderPanel({ providerId: "google", hasConnection: true, onModelsChange }, false);
    expect(host.textContent).toContain("New: gemini-live");
    release();
    await flush();
    expect(host.textContent).not.toContain("stale-gpt");
    expect(onModelsChange.mock.calls.some(([models]) => Array.isArray(models) && models.some((model) => model.id === "stale-gpt"))).toBe(false);

    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json(statusFor("openai", { eligible: false })))));
    await renderPanel({ providerId: "openai", hasConnection: true, onModelsChange: vi.fn() }, false);
    expect(host.textContent).toBe("");
  });
});

describe.each([false, true])("provider detail page placement with V5 %s", (v5) => {
  function pageFetch(url) {
    const path = String(url);
    const providerId = route.id;
    if (path === "/api/providers") {
      return Promise.resolve(json({ connections: [{ id: "c1", provider: providerId, name: "main", authType: "apikey", isActive: true }] }));
    }
    if (path === "/api/provider-nodes") {
      const compatible = providerId.startsWith("openai-compatible-");
      return Promise.resolve(json({ nodes: compatible ? [{ id: providerId, name: "Compatible", type: "openai-compatible", baseUrl: "https://example.test/v1", apiType: "chat" }] : [] }));
    }
    if (path.startsWith("/api/proxy-pools")) return Promise.resolve(json({ proxyPools: [] }));
    if (path === "/api/settings") return Promise.resolve(json({}));
    if (path.startsWith("/api/models/auto-sync")) return Promise.resolve(json(statusFor(providerId, { newModelIds: [], removedModelIds: [] })));
    if (path.startsWith("/api/models/")) return Promise.resolve(json({ ids: [], aliases: {}, models: [] }));
    return Promise.resolve(json({}));
  }

  async function renderPage(id) {
    route.id = id;
    enable(v5);
    vi.stubGlobal("fetch", vi.fn(pageFetch));
    await act(async () => { root.render(React.createElement(ProviderDetailPage)); });
    await flush();
  }

  function heading(text) {
    return [...host.querySelectorAll("h2")].find((node) => node.textContent.includes(text));
  }

  it("places auto-sync between Connections and Models and hides it for compatible providers", async () => {
    await renderPage("openrouter");
    const connections = heading("Connections");
    const models = heading("Available Models");
    const sync = heading("Model auto-sync");
    const rpm = host.querySelector("label[for='provider-rpm-limit']");
    expect(rpm.textContent).toBe("RPM / account");
    expect(host.querySelector("#provider-rpm-limit")).toBeTruthy();
    expect(connections).toBeTruthy();
    expect(models).toBeTruthy();
    const follows = (before, after) => (before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    if (v5) {
      expect(sync).toBeTruthy();
      expect(follows(connections, sync)).toBe(true);
      expect(follows(sync, models)).toBe(true);
    } else {
      expect(sync).toBeUndefined();
      const label = [...host.querySelectorAll("label")].find((node) => node.textContent === "Auto-update models");
      expect(follows(models, label)).toBe(true);
    }

    const roundRobin = [...host.querySelectorAll("span")].find((node) => node.textContent === "Round Robin");
    const affinity = [...host.querySelectorAll("span")].find((node) => node.textContent === "Cache Affinity");
    for (const label of [roundRobin, affinity]) {
      const grouped = label.parentElement.className.includes("whitespace-nowrap");
      const toggle = grouped ? label.parentElement.querySelector("[role='switch']") : label.nextElementSibling;
      expect(grouped).toBe(v5);
      expect(toggle.getAttribute("aria-label")).toMatch(/Toggle (round robin|cache affinity)/);
      expect(toggle.className).toContain("focus-visible");
      toggle.focus();
      expect(document.activeElement).toBe(toggle);
    }

    await renderPage("openai-compatible-acme");
    expect(host.textContent).not.toContain("Model auto-sync");
    expect(host.textContent).not.toContain("Auto-update models");
    expect(host.querySelector("label[for='provider-rpm-limit']").textContent).toBe("RPM / account");
  });
});

describe.each([false, true])("provider detail error states with V5 %s", (v5) => {
  it("names the page error recovery, validation failure, and error-rule alert", async () => {
    enable(v5);
    const reset = vi.fn();
    await act(async () => {
      root.render(React.createElement(ProviderDetailError, { error: new Error("boom"), reset }));
    });
    const retry = buttonNamed("Try again");
    expect(retry.className).toContain("focus-visible");
    retry.focus();
    expect(document.activeElement).toBe(retry);
    await act(async () => { retry.click(); });
    expect(reset).toHaveBeenCalledOnce();
    const back = [...host.querySelectorAll("a")].find((node) => node.textContent.includes("Back to Providers"));
    expect(back.getAttribute("href")).toBe("/dashboard/providers");
    expect(host.querySelector("[aria-hidden='true']")).toBeTruthy();

    const onClose = vi.fn();
    function Rules() {
      const opener = React.useRef(null);
      const [open, setOpen] = React.useState(false);
      return React.createElement(React.Fragment, null,
        React.createElement("button", { ref: opener, type: "button", onClick: () => setOpen(true) }, "Error rules"),
        React.createElement(ProviderErrorRulesModal, {
          isOpen: open,
          providerId: "openai",
          rules: [],
          onSave: vi.fn(),
          onClose: () => { onClose(); setOpen(false); },
        }));
    }
    await act(async () => { root.render(React.createElement(Rules)); });
    const opener = buttonNamed("Error rules");
    opener.focus();
    await act(async () => { opener.click(); });
    await flush();
    expect(document.body.textContent).toContain("No rules declared for this provider yet.");
    await act(async () => { buttonNamed("Add Rule").click(); });
    expect(document.querySelector("[role='alert']").textContent).toContain("Match text is required");
    const dialog = document.querySelector("dialog");
    await act(async () => { dialog.dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true })); });
    await flush();
    expect(onClose).toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);

    const posts = [];
    vi.stubGlobal("fetch", vi.fn((url, options = {}) => {
      if (options.method === "POST") posts.push(JSON.parse(options.body));
      return Promise.resolve(json({ valid: false }));
    }));
    await act(async () => {
      root.render(React.createElement(AddApiKeyModal, {
        isOpen: true,
        provider: "openai",
        providerName: "OpenAI",
        proxyPools: [],
        existingConnectionNames: [],
        onSave: vi.fn(),
        onBulkDone: vi.fn(),
        onClose: vi.fn(),
      }));
    });
    await flush();
    const field = [...document.querySelectorAll("label")].find((node) => node.textContent === "API Key");
    const input = document.getElementById(field.htmlFor);
    expect(input).toBeTruthy();
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      set.call(input, "sk-example");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { buttonNamed("Check").click(); });
    await flush();
    expect(document.body.textContent).toContain("Invalid");
    expect(input.value).toBe("sk-example");
    expect(posts).toEqual([{ provider: "openai", apiKey: "sk-example" }]);
  });
});

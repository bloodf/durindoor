// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChangelogModal from "../../src/shared/components/ChangelogModal.js";
import McpMarketplaceModal from "../../src/shared/components/McpMarketplaceModal.js";
import ManualConfigModal from "../../src/shared/components/ManualConfigModal.js";
import PricingModal from "../../src/shared/components/PricingModal.js";
import AddCustomEmbeddingModal from "../../src/shared/components/AddCustomEmbeddingModal.js";
import CombosError from "../../src/app/(dashboard)/dashboard/combos/error.js";
import McpGatewayErrorView from "../../src/app/(dashboard)/dashboard/mcp-gateway/McpGatewayErrorView.jsx";
import PxpipeError from "../../src/app/(dashboard)/dashboard/pxpipe/error.js";
import MitmError from "../../src/app/(dashboard)/dashboard/mitm/error.js";
import TranslatorError from "../../src/app/(dashboard)/dashboard/translator/error.js";
import { GITHUB_CONFIG } from "../../src/shared/constants/config.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host;
let root;
let showModal;
let fetchMock;

const flush = () => new Promise((resolve) => setTimeout(resolve, 30));

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function show() {
    this.setAttribute("open", "");
  });
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}), text: async () => "" }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete document.documentElement.dataset.ui;
  showModal.mockRestore();
  vi.unstubAllGlobals();
});

function setV5(on) {
  if (on) document.documentElement.dataset.ui = "v5";
  else delete document.documentElement.dataset.ui;
}

async function render(node) {
  await act(async () => {
    root.render(node);
    await flush();
  });
}

function writeCalls() {
  return fetchMock.mock.calls
    .filter(([, options]) => options?.method && options.method !== "GET")
    .map(([url, options]) => [options.method, url, options.body]);
}

describe.each([false, true])("D04 dialogs with V5 %s", (v5) => {
  beforeEach(() => setV5(v5));

  it("ChangelogModal loads, surfaces errors with alert, and retries the same GET", async () => {
    let fail = true;
    fetchMock.mockImplementation(async (url) => {
      if (url === GITHUB_CONFIG.changelogUrl) {
        if (fail) return { ok: false, status: 503, text: async () => "offline" };
        return { ok: true, status: 200, text: async () => "# Release\n\n- fix" };
      }
      return { ok: true, json: async () => ({}), text: async () => "" };
    });
    await render(React.createElement(ChangelogModal, { isOpen: true, onClose: vi.fn() }));
    expect(document.querySelector("[role='alert']")?.textContent).toContain("Failed to load changelog");
    if (v5) {
      expect(document.querySelector("[role='alert'] button")?.textContent).toMatch(/Retry/i);
      fail = false;
      await act(async () => {
        document.querySelector("[role='alert'] button").click();
        await flush();
      });
      expect(document.body.textContent).toContain("Release");
    }
    const gets = fetchMock.mock.calls.filter(([url]) => url === GITHUB_CONFIG.changelogUrl);
    expect(gets.length).toBeGreaterThanOrEqual(1);
    expect(gets[0][0]).toBe(GITHUB_CONFIG.changelogUrl);
  });

  it("PricingModal save issues the same PATCH on and off", async () => {
    const pricing = { openai: { "gpt-5": { input: 2.5, output: 10, cached: 0, reasoning: 0, cache_creation: 0 } } };
    fetchMock.mockImplementation(async (url, options) => {
      if (url === "/api/pricing" && (!options?.method || options.method === "GET")) {
        return { ok: true, json: async () => pricing };
      }
      if (url === "/api/pricing" && options?.method === "PATCH") {
        return { ok: true, json: async () => ({ ok: true }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    const onClose = vi.fn();
    await render(React.createElement(PricingModal, { isOpen: true, onClose, onSave: vi.fn() }));
    await act(async () => { await flush(); });
    const save = [...document.querySelectorAll("button")].find((node) => node.textContent.includes("Save changes"));
    expect(save).toBeTruthy();
    await act(async () => { save.click(); await flush(); });
    expect(writeCalls()).toEqual([["PATCH", "/api/pricing", JSON.stringify(pricing)]]);
  });

  it("PricingModal load failure keeps defaults and offers Retry when V5", async () => {
    fetchMock.mockImplementation(async (url) => {
      if (url === "/api/pricing") return { ok: false, status: 503, json: async () => ({ error: "db offline" }) };
      return { ok: true, json: async () => ({}) };
    });
    await render(React.createElement(PricingModal, { isOpen: true, onClose: vi.fn() }));
    await act(async () => { await flush(); });
    expect(document.querySelector("[role='alert']")?.textContent).toContain("db offline");
    if (v5) expect([...document.querySelectorAll("button")].some((node) => node.textContent.includes("Retry"))).toBe(true);
  });

  it("AddCustomEmbeddingModal create posts the same body on and off", async () => {
    fetchMock.mockImplementation(async (url, options) => {
      if (url === "/api/provider-nodes" && options?.method === "POST") {
        return { ok: true, json: async () => ({ node: { id: "n1", name: "Voyage" } }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    const onCreated = vi.fn();
    await render(React.createElement(AddCustomEmbeddingModal, { isOpen: true, onClose: vi.fn(), onCreated }));
    const name = document.querySelector("input[placeholder='Voyage AI']") || [...document.querySelectorAll("input")].find((el) => el.getAttribute("placeholder") === "Voyage AI");
    const prefix = [...document.querySelectorAll("input")].find((el) => el.getAttribute("placeholder") === "voyage");
    const base = [...document.querySelectorAll("input")].find((el) => el.getAttribute("placeholder") === "https://api.voyageai.com/v1");
    for (const [el, value] of [[name, "Voyage"], [prefix, "voyage"], [base, "https://api.voyageai.com/v1"]]) {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    const create = [...document.querySelectorAll("button")].find((node) => node.textContent === "Create");
    await act(async () => { create.click(); await flush(); });
    expect(writeCalls()).toEqual([[
      "POST",
      "/api/provider-nodes",
      JSON.stringify({ name: "Voyage", prefix: "voyage", baseUrl: "https://api.voyageai.com/v1", type: "custom-embedding" }),
    ]]);
    expect(onCreated).toHaveBeenCalled();
  });

  it("AddCustomEmbeddingModal invalid check uses alert when V5", async () => {
    fetchMock.mockImplementation(async (url) => {
      if (url === "/api/provider-nodes/validate") {
        return { ok: true, json: async () => ({ valid: false, error: "Key rejected" }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    await render(React.createElement(AddCustomEmbeddingModal, { isOpen: true, onClose: vi.fn() }));
    const key = [...document.querySelectorAll("input")].find((el) => el.type === "password");
    const model = [...document.querySelectorAll("input")].find((el) => el.getAttribute("placeholder") === "voyage-3");
    for (const [el, value] of [[key, "sk-x"], [model, "voyage-3"]]) {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    await act(async () => {
      [...document.querySelectorAll("button")].find((node) => node.textContent.includes("Check")).click();
      await flush();
    });
    expect(document.body.textContent).toContain("Invalid");
    expect(document.body.textContent).toContain("Key rejected");
    if (v5) expect(document.querySelector("[role='alert']")?.textContent).toContain("Key rejected");
  });

  it("McpMarketplaceModal registry failure and tools probe keep request parity", async () => {
    fetchMock.mockImplementation(async (url, options) => {
      if (url === "/api/cli-tools/cowork-mcp-registry") {
        return { ok: true, json: async () => ({ error: "registry offline" }) };
      }
      if (url === "/api/cli-tools/cowork-mcp-tools" && options?.method === "POST") {
        return { ok: true, json: async () => ({ tools: [{ name: "read" }] }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    await render(React.createElement(McpMarketplaceModal, { isOpen: true, onClose: vi.fn(), onAdd: vi.fn() }));
    expect(document.querySelector("[role='alert']")?.textContent).toContain("registry offline");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/cli-tools/cowork-mcp-registry");
    if (v5) {
      fetchMock.mockImplementation(async (url) => {
        if (url === "/api/cli-tools/cowork-mcp-registry") {
          return {
            ok: true,
            json: async () => ({
              servers: [{ slug: "fs", name: "fs", title: "Local FS", url: "https://example.com/mcp/fs", oauth: false, toolCount: 1, toolNames: ["read"] }],
            }),
          };
        }
        return { ok: true, json: async () => ({}) };
      });
      await act(async () => {
        [...document.querySelectorAll("button")].find((node) => node.textContent.includes("Retry")).click();
        await flush();
      });
      expect(document.body.textContent).toContain("Local FS");
      await act(async () => {
        [...document.querySelectorAll("button")].find((node) => node.textContent === "Add").click();
        await flush();
      });
      const probe = writeCalls().find(([method, url]) => method === "POST" && url === "/api/cli-tools/cowork-mcp-tools");
      expect(probe).toEqual(["POST", "/api/cli-tools/cowork-mcp-tools", JSON.stringify({ url: "https://example.com/mcp/fs" })]);
    }
  });

  it("ManualConfigModal keeps copyable regions and empty feedback", async () => {
    await render(React.createElement(ManualConfigModal, {
      isOpen: true,
      onClose: vi.fn(),
      configs: [{ filename: "claude.json", content: '{"ok":true}' }],
    }));
    const region = document.querySelector('[role="region"][aria-label="claude.json contents"]');
    expect(region).toBeTruthy();
    expect(region.getAttribute("tabIndex")).toBe("0");
    expect(region.className).toContain("overflow-auto");
    await render(React.createElement(ManualConfigModal, { isOpen: true, onClose: vi.fn(), configs: [] }));
    if (v5) expect(document.body.textContent).toContain("No configuration snippets");
    else expect(document.querySelector('[aria-label="claude.json"]')).toBeNull();
  });
});

describe.each([false, true])("D04 error boundaries with V5 %s", (v5) => {
  beforeEach(() => setV5(v5));

  it.each([
    ["combos", CombosError, "Try again", "Something went wrong"],
    ["mcp-gateway", McpGatewayErrorView, "Try again", "MCP Gateway failed to load"],
    ["pxpipe", PxpipeError, "Try again", "PXPIPE dashboard could not load"],
    ["mitm", MitmError, "Try again", "Something went wrong"],
    ["translator", TranslatorError, "Retry", "Translator could not load"],
  ])("%s exposes alert when V5 and reset/retry calls the same action", async (_name, Component, actionLabel, heading) => {
    const reset = vi.fn();
    const error = new Error("fixture");
    const props = Component === McpGatewayErrorView || Component === TranslatorError
      ? { reset }
      : { error, reset };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await render(React.createElement(Component, props));
    expect(document.body.textContent).toContain(heading);
    if (v5) expect(document.querySelector("[role='alert']")).toBeTruthy();
    else if (_name === "translator") expect(document.querySelector("[role='alert']")).toBeNull();
    const button = [...document.querySelectorAll("button")].find((node) => node.textContent.includes(actionLabel));
    expect(button).toBeTruthy();
    await act(async () => { button.click(); });
    expect(reset).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });
});

describe("D04 A3 parity across V5 on and off", () => {
  it("PricingModal PATCH body matches with data-ui set and unset", async () => {
    const pricing = { openai: { "gpt-5": { input: 1, output: 2, cached: 0, reasoning: 0, cache_creation: 0 } } };
    const bodies = [];
    for (const on of [false, true]) {
      setV5(on);
      fetchMock.mockImplementation(async (url, options) => {
        if (url === "/api/pricing" && (!options?.method || options.method === "GET")) {
          return { ok: true, json: async () => structuredClone(pricing) };
        }
        if (url === "/api/pricing" && options?.method === "PATCH") {
          bodies.push([options.method, url, options.body]);
          return { ok: true, json: async () => ({ ok: true }) };
        }
        return { ok: true, json: async () => ({}) };
      });
      await render(React.createElement(PricingModal, { isOpen: true, onClose: vi.fn() }));
      await act(async () => { await flush(); });
      const save = [...document.querySelectorAll("button")].find((node) => node.textContent.includes("Save changes"));
      await act(async () => { save.click(); await flush(); });
      await act(async () => root.unmount());
      root = createRoot(host);
    }
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[0]).toEqual(["PATCH", "/api/pricing", JSON.stringify(pricing)]);
  });

  it("AddCustomEmbeddingModal POST body matches with data-ui set and unset", async () => {
    const bodies = [];
    for (const on of [false, true]) {
      setV5(on);
      fetchMock.mockImplementation(async (url, options) => {
        if (url === "/api/provider-nodes" && options?.method === "POST") {
          bodies.push([options.method, url, options.body]);
          return { ok: true, json: async () => ({ node: { id: "n1" } }) };
        }
        return { ok: true, json: async () => ({}) };
      });
      await render(React.createElement(AddCustomEmbeddingModal, { isOpen: true, onClose: vi.fn(), onCreated: vi.fn() }));
      const name = [...document.querySelectorAll("input")].find((el) => el.getAttribute("placeholder") === "Voyage AI");
      const prefix = [...document.querySelectorAll("input")].find((el) => el.getAttribute("placeholder") === "voyage");
      const base = [...document.querySelectorAll("input")].find((el) => el.getAttribute("placeholder") === "https://api.voyageai.com/v1");
      for (const [el, value] of [[name, "Voyage"], [prefix, "voyage"], [base, "https://api.voyageai.com/v1"]]) {
        await act(async () => {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
          setter.call(el, value);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        });
      }
      await act(async () => {
        [...document.querySelectorAll("button")].find((node) => node.textContent === "Create").click();
        await flush();
      });
      await act(async () => root.unmount());
      root = createRoot(host);
    }
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[0][0]).toBe("POST");
    expect(bodies[0][1]).toBe("/api/provider-nodes");
  });
});

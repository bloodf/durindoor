// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ModelSelectModal from "@/shared/components/ModelSelectModal.js";

vi.mock("@/shared/constants/providers", async (importOriginal) => ({
  ...await importOriginal(),
  OAUTH_PROVIDERS: {}, FREE_PROVIDERS: {}, FREE_TIER_PROVIDERS: {},
  APIKEY_PROVIDERS: { fixture: { name: "Fixture" } },
  AI_PROVIDERS: { fixture: { name: "Fixture" } },
  getProviderAlias: (id) => id,
}));
vi.mock("@/shared/constants/models", () => ({
  getModelsByProviderId: () => [{ id: "chat", name: "Fixture chat", kind: "llm" }],
  getModelKind: (model) => model.kind,
}));
vi.mock("@/shared/hooks/useModelCaps", () => ({ useModelCaps: () => ({ getCaps: () => null }) }));
vi.mock("@/shared/hooks/useOrcaRouterCatalog", () => ({ useOrcaRouterCatalog: () => ({ models: [] }) }));

let root;
let host;
const originalShowModal = HTMLDialogElement.prototype.showModal;
const originalClose = HTMLDialogElement.prototype.close;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // Only supplies missing DOM methods; native browser modality remains a separate gate.
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  const responses = {
    "/api/settings": { hidePaidModels: false },
    "/api/combos": { combos: [] },
    "/api/provider-nodes": { nodes: [] },
    "/api/models/custom": { models: [] },
    "/api/models/disabled": { disabled: {} },
    "/api/models/auto-sync": { providers: {} },
  };
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    if (!Object.hasOwn(responses, url)) throw new Error(`Unexpected fixture fetch: ${url}`);
    return { ok: true, json: async () => responses[url] };
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  HTMLDialogElement.prototype.showModal = originalShowModal;
  HTMLDialogElement.prototype.close = originalClose;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function search(input, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("production model selector empty-search announcement", () => {

  it.each([true, false])("does not announce empty while the catalog is pending or failed: %s", async (success) => {
    const otherFetch = fetch.getMockImplementation();
    let finishCatalog;
    fetch.mockImplementation((url, ...args) => {
      if (url === "/api/settings") return Promise.resolve({ ok: true, json: async () => ({ hidePaidModels: true }) });
      if (url === "/api/v1/models") return new Promise((resolve) => { finishCatalog = resolve; });
      return otherFetch(url, ...args);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => root.render(React.createElement(ModelSelectModal, { isOpen: true, onClose: vi.fn(), onSelect: vi.fn(), activeProviders: [{ provider: "fixture", isActive: true }] })));
    const dialog = document.body.querySelector("dialog");
    const status = dialog.querySelector('[role="status"][aria-atomic="true"]');
    const input = dialog.querySelector('input[aria-label="Search models"]');
    expect(status.textContent).not.toContain("No models found");
    await search(input, "no-match-fixture");
    expect(status.textContent).not.toContain("No models found");
    await search(input, "Fixture chat");
    await act(async () => finishCatalog({ ok: success, status: success ? 200 : 500, json: async () => ({ data: [{ id: "fixture/chat" }] }) }));
    expect(status.textContent).not.toContain("No models found");
    expect(status.isConnected).toBe(true);
    if (success) {
      expect(dialog.textContent).toContain("Fixture chat");
      await search(input, "no-match-fixture");
      expect(status.textContent).toContain("No models found");
    }
  });

  it("announces No models found while preserving search focus and dialog dismissal", async () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    await act(async () => root.render(React.createElement(ModelSelectModal, {
      isOpen: true, onClose, onSelect,
      activeProviders: [{ provider: "fixture", isActive: true }],
    })));
    const dialog = document.body.querySelector("dialog");
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")).textContent).toBe("Select Model");
    const input = dialog.querySelector('input[aria-label="Search models"]');
    input.focus();
    expect(dialog.textContent).toContain("Fixture chat");
    await search(input, "no-match-fixture");
    expect(dialog.textContent).toContain("No models found");
    expect(dialog.textContent).toContain("Try a different search or connect a new provider.");
    const status = [...dialog.querySelectorAll('[role="status"]')]
      .find((node) => node.textContent.includes("No models found"));
    expect(status, "Empty results must request a polite announcement").toBeDefined();
    expect(status.getAttribute("aria-atomic")).toBe("true");
    expect(document.activeElement).toBe(input);
    await search(input, "Fixture chat");
    expect(status.isConnected).toBe(true);
    expect(status.textContent).toBe("");
    expect(dialog.textContent).toContain("Fixture chat");
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => dialog.dispatchEvent(new Event("cancel", { bubbles: false, cancelable: true })));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

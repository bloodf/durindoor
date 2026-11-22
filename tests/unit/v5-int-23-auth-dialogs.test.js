// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OrcaRouterAuthModal from "../../src/shared/components/OrcaRouterAuthModal.js";
import ImportTokenModal from "../../src/shared/components/ImportTokenModal.js";
import IFlowCookieModal from "../../src/shared/components/IFlowCookieModal.js";
import CursorAuthModal from "../../src/shared/components/CursorAuthModal.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root, showModal;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function () { this.setAttribute("open", ""); });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete document.documentElement.dataset.ui;
  showModal.mockRestore();
  vi.unstubAllGlobals();
});

// V5 changes dialog surfaces and announces copy feedback; credential requests remain identical.
describe.each([false, true])("provider sign-in with V5 %s", (v5) => {
  it("keeps the dialog named and its import request unchanged", async () => {
    if (v5) document.documentElement.dataset.ui = "v5";
    const fetchMock = vi.fn(async (url) => ({ ok: true, json: async () => url.endsWith("auto-import") ? { found: true, accessToken: "token", machineId: "machine" } : { ok: true } }));
    vi.stubGlobal("fetch", fetchMock);
    const onClose = vi.fn();
    await act(async () => { root.render(React.createElement(CursorAuthModal, { isOpen: true, onClose })); });
    const dialog = document.querySelector("dialog");
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
    expect(dialog.textContent).toContain("Connect Cursor IDE");
    expect(dialog.querySelector('[role="document"]').className.includes("[&>header]:bg-dd-surface-2")).toBe(v5);
    const button = [...dialog.querySelectorAll("button")].find((element) => element.textContent.includes("Import Token"));
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(fetchMock).toHaveBeenLastCalledWith("/api/oauth/cursor/import", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: "token", machineId: "machine" }),
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("supports Escape and returns focus to the opener", async () => {
    if (v5) document.documentElement.dataset.ui = "v5";
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ found: false }) })));
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const onClose = vi.fn();
    await act(async () => root.render(React.createElement(CursorAuthModal, { isOpen: true, onClose })));
    await act(async () => document.querySelector("dialog").dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true })));
    expect(onClose).toHaveBeenCalled();
    await act(async () => root.render(React.createElement(CursorAuthModal, { isOpen: false, onClose })));
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("exposes the OrcaRouter method selection with its existing button behavior", async () => {
    if (v5) document.documentElement.dataset.ui = "v5";
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ connections: [] }) })));
    await act(async () => root.render(React.createElement(OrcaRouterAuthModal, { isOpen: true, onClose: vi.fn() })));
    const auth = document.querySelector('[data-testid="orca-tab-auth"]');
    const api = document.querySelector('[data-testid="orca-tab-api"]');
    expect(auth.getAttribute(v5 ? "aria-pressed" : "aria-selected")).toBe("true");
    await act(async () => api.click());
    expect(api.getAttribute(v5 ? "aria-pressed" : "aria-selected")).toBe("true");
    expect(document.querySelector("dialog").textContent).toContain("OrcaRouter API key");
  });

  it.each([
    [ImportTokenModal, { provider: "github" }, "input", "Connect", "/api/oauth/github/import-token", { accessToken: "sample" }],
    [IFlowCookieModal, {}, "textarea", "Authenticate", "/api/oauth/iflow/cookie", { cookie: "sample" }],
  ])("preserves the credential submission for %s", async (Component, props, selector, label, url, body) => {
    if (v5) document.documentElement.dataset.ui = "v5";
    const fetchMock = vi.fn(async () => ({ ok: false, json: async () => ({ error: "rejected" }) }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(React.createElement(Component, { ...props, isOpen: true, onClose: vi.fn() })));
    const input = document.querySelector(`dialog ${selector}`);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value").set;
      setter.call(input, " sample ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const button = [...document.querySelectorAll("dialog button")].find((node) => node.textContent.includes(label));
    await act(async () => button.click());
    expect(fetchMock).toHaveBeenCalledWith(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    expect(document.querySelector('dialog [role="alert"]')).toBeTruthy();
  });

});

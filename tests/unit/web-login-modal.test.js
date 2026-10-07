// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebLoginModal from "@/shared/components/WebLoginModal.js";
import AddApiKeyModal from "@/app/(dashboard)/dashboard/providers/[id]/AddApiKeyModal.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
let container;
let status;
let routes;
const props = { isOpen: true, provider: "grok-web", providerName: "Grok Web", initialName: "Personal account", onClose: vi.fn(), onSuccess: vi.fn() };
const render = (element) => act(async () => root.render(element));
const button = (label) => Array.from(document.body.querySelectorAll("button")).find((node) => node.textContent.includes(label));
const click = (label) => act(async () => button(label).click());
const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(2000); });

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  props.onClose.mockClear();
  props.onSuccess.mockClear();
  status = { provider: "grok-web", captured: [], ready: false };
  routes = {
    start: { pageUrl: "https://login.gateway.example/__web_login/bootstrap?grant=iframe" },
    popup: { pageUrl: "https://login.gateway.example/__web_login/bootstrap?grant=popup" },
    finish: { id: "connection-1", provider: "grok-web", name: "Personal account" },
    cancel: { success: true },
  };
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const action = url.split("/").pop();
    const body = action === "status" ? status : routes[action];
    return { ok: !body.error, json: async () => body };
  }));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isolated web login modal", () => {
  it("polls every two seconds, displays cookie names and saves only when ready", async () => {
    await render(React.createElement(WebLoginModal, props));
    const iframe = document.body.querySelector("iframe");
    expect(iframe.src).toBe(routes.start.pageUrl);
    expect(iframe.getAttribute("sandbox")).toBe("allow-forms allow-scripts allow-same-origin allow-popups");
    expect(iframe.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(button("Save connection").disabled).toBe(true);
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining("/status"), expect.anything());
    status = { provider: "grok-web", captured: ["sso"], ready: true };
    await tick();
    expect(document.body.textContent).toContain("Captured cookies: sso");
    expect(button("Save connection").disabled).toBe(false);
    await click("Save connection");
    expect(fetch).toHaveBeenCalledWith("/api/providers/web-login/finish", expect.objectContaining({ body: JSON.stringify({ provider: "grok-web", name: "Personal account" }) }));
    expect(props.onSuccess).toHaveBeenCalledWith(routes.finish);
    await render(React.createElement(WebLoginModal, { ...props, isOpen: false }));
    expect(fetch.mock.calls.some(([url]) => url.endsWith("/cancel"))).toBe(false);
  });

  it("preopens a detached popup before requesting a fresh grant", async () => {
    const popup = { opener: window, document: document.implementation.createHTMLDocument(), location: { replace: vi.fn() }, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockImplementation(() => {
      expect(fetch.mock.calls.some(([url]) => url.endsWith("/popup"))).toBe(false);
      return popup;
    });
    await render(React.createElement(WebLoginModal, props));
    await click("Open in popup");
    expect(open).toHaveBeenCalledWith("about:blank", "_blank", expect.any(String));
    expect(popup.opener).toBeNull();
    expect(popup.document.querySelector('meta[name="referrer"]').content).toBe("no-referrer");
    expect(fetch).toHaveBeenCalledWith("/api/providers/web-login/popup", expect.objectContaining({ method: "POST", body: JSON.stringify({ provider: "grok-web" }) }));
    expect(popup.location.replace).toHaveBeenCalledWith(routes.popup.pageUrl);
    expect(popup.location.replace).not.toHaveBeenCalledWith(routes.start.pageUrl);
    await render(React.createElement(WebLoginModal, { ...props, isOpen: false }));
    expect(popup.close).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith("/api/providers/web-login/cancel", expect.objectContaining({ keepalive: true }));
  });

  it("reports status errors and cancels on unmount", async () => {
    await render(React.createElement(WebLoginModal, props));
    status = { error: "Login session expired" };
    await tick();
    expect(document.body.querySelector('[role="alert"]').textContent).toBe("Login session expired");
    expect(button("Save connection").disabled).toBe(true);
    await render(null);
    expect(fetch).toHaveBeenCalledWith("/api/providers/web-login/cancel", expect.anything());
    const count = fetch.mock.calls.length;
    await tick();
    expect(fetch.mock.calls).toHaveLength(count);
  });

  it("shows save failures without discarding the session", async () => {
    routes.finish = { error: "Connection name already exists" };
    await render(React.createElement(WebLoginModal, props));
    status = { provider: "grok-web", captured: ["sso"], ready: true };
    await tick();
    await click("Save connection");
    expect(document.body.querySelector('[role="alert"]').textContent).toBe("Connection name already exists");
    expect(props.onSuccess).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(button("Save connection").disabled).toBe(false);
  });

  it("reports a blocked popup without requesting another grant", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    await render(React.createElement(WebLoginModal, props));
    await click("Open in popup");
    expect(document.body.querySelector('[role="alert"]').textContent).toContain("Popup blocked");
    expect(fetch.mock.calls.some(([url]) => url.endsWith("/popup"))).toBe(false);
  });

  it("rejects login URLs sharing the dashboard hostname", async () => {
    routes.start = { pageUrl: `${window.location.origin}/__web_login/bootstrap?grant=unsafe` };
    await render(React.createElement(WebLoginModal, props));
    expect(document.body.querySelector("iframe")).toBeNull();
    expect(document.body.querySelector('[role="alert"]').textContent).toContain("separate, configured hostname");
  });

  it("closes a cancelled login when restored from the back-forward cache", async () => {
    await render(React.createElement(WebLoginModal, props));
    const hide = new Event("pagehide");
    Object.defineProperty(hide, "persisted", { value: true });
    await act(async () => window.dispatchEvent(hide));
    expect(fetch.mock.calls.some(([url]) => url.endsWith("/cancel"))).toBe(true);
    const show = new Event("pageshow");
    Object.defineProperty(show, "persisted", { value: true });
    await act(async () => window.dispatchEvent(show));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    await render(React.createElement(WebLoginModal, { ...props, isOpen: false }));
    const previousStarts = fetch.mock.calls.filter(([url]) => url.endsWith("/start")).length;
    await render(React.createElement(WebLoginModal, props));
    expect(fetch.mock.calls.filter(([url]) => url.endsWith("/start"))).toHaveLength(previousStarts + 1);
    status = { provider: "grok-web", captured: ["sso"], ready: true };
    await tick();
    expect(button("Save connection").disabled).toBe(false);
  });

  it("keeps manual paste available and restores it when login is cancelled", async () => {
    const modalProps = { isOpen: true, provider: "grok-web", providerName: "Grok Web", authType: "cookie", webLogin: {}, onSave: vi.fn(), onClose: vi.fn(), existingConnectionNames: [] };
    await render(React.createElement(AddApiKeyModal, modalProps));
    expect(document.body.textContent).toContain("Cookie Value");
    await click("Sign in in-page");
    expect(document.body.querySelector("iframe")).not.toBeNull();
    await click("Cancel");
    expect(document.body.querySelector("iframe")).toBeNull();
    expect(document.body.textContent).toContain("Cookie Value");
    await render(React.createElement(AddApiKeyModal, { ...modalProps, webLogin: undefined }));
    expect(button("Sign in in-page")).toBeUndefined();
  });
});

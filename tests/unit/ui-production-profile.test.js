// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import ProfilePage from "@/app/(dashboard)/dashboard/profile/page";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = React.createElement;
const roots = [];
const originalShowModal = HTMLDialogElement.prototype.showModal;
const originalClose = HTMLDialogElement.prototype.close;
const settings = {
  fallbackStrategy: "fill-first",
  comboStrategy: "fallback",
  requireLogin: true,
  hasPassword: true,
  authMode: "password",
  exposeComboOnly: false,
  hidePaidModels: false,
  enableObservability: true,
  enableProxyTimeline: true,
  proxyTimelineRetentionDays: 7,
  visionBridgeModel: "openai/gpt-4o",
  visionBridgeEnabled: true,
  outboundProxyEnabled: false,
};

function render(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push([root, container]);
  act(() => root.render(element));
}

async function flush() {
  await act(async () => { await Promise.resolve(); });
}

function setValue(input, value) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function shimShowModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function shimClose() {
    this.removeAttribute("open");
  };
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    if (url === "/api/settings" && (!init.method || init.method === "GET")) {
      return new Response(JSON.stringify(settings), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  });
});

afterEach(() => {
  while (roots.length) {
    const [root, container] = roots.pop();
    act(() => root.unmount());
    container.remove();
  }
  HTMLDialogElement.prototype.showModal = originalShowModal;
  HTMLDialogElement.prototype.close = originalClose;
  document.body.innerHTML = "";
});

describe("profile settings behavior", () => {
  it("rejects mismatched passwords before saving", async () => {
    render(h(ProfilePage));
    await flush();
    setValue(document.querySelector("#profile-current-password"), "old-password");
    setValue(document.querySelector("#profile-new-password"), "new-password");
    setValue(document.querySelector("#profile-confirm-password"), "different-password");
    await act(async () => document.querySelector("#profile-confirm-password").closest("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(document.body.textContent).toContain("Passwords do not match");
    expect(globalThis.fetch.mock.calls.filter(([url, init]) => url === "/api/settings" && init?.method === "PATCH")).toHaveLength(0);
  });

  it("keeps save failure visible for invalid Firecrawl URL without a request", async () => {
    render(h(ProfilePage));
    await flush();
    const input = [...document.querySelectorAll("input")].find((node) => node.getAttribute("placeholder") === "https://api.firecrawl.dev");
    setValue(input, "not-a-url");
    await act(async () => input.closest("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(document.body.textContent).toContain("Invalid URL");
    expect(globalThis.fetch.mock.calls.filter(([url, init]) => url === "/api/settings" && init?.method === "PATCH")).toHaveLength(0);
  });

  it("dismisses shutdown confirmation without sending shutdown request", async () => {
    render(h(ProfilePage));
    await flush();
    await act(async () => [...document.querySelectorAll("button")].find((button) => button.textContent.includes("Shutdown")).click());
    const dialog = document.querySelector("dialog[open]");
    expect(dialog?.textContent).toContain("Close Proxy");
    await act(async () => [...dialog.querySelectorAll("button")].find((button) => button.textContent.trim() === "Cancel").click());
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalledWith("/api/version/shutdown", expect.anything());
  });
});

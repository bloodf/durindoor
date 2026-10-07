// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/endpoint",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }) =>
    React.createElement("a", { href, ...props }, children),
}));
vi.mock("../../src/shared/components/Header.js", () => ({
  default: ({ onMenuClick }) =>
    React.createElement("button", { onClick: onMenuClick }, "Open navigation"),
}));
import DashboardLayout from "../../src/shared/components/layouts/DashboardLayout.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, host;
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ enableTranslator: true }),
    })),
  );
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    })),
  );
  // Happy DOM has no browser top layer. The browser suite verifies real dialog sizing/scroll.
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(
    function () {
      this.open = true;
    },
  );
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(
    function () {
      this.open = false;
    },
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("dashboard navigation drawer", () => {
  it("opens, closes after selecting a lower navigation route, and restores focus", async () => {
    await act(async () =>
      root.render(
        React.createElement(DashboardLayout, null, "Endpoint content"),
      ),
    );
    const trigger = [...host.querySelectorAll("button")].find(
      (el) => el.textContent === "Open navigation",
    );
    trigger.focus();
    await act(async () => trigger.click());
    const dialog = document.querySelector("dialog[open]");
    expect(dialog).not.toBeNull();
    const translator = dialog.querySelector('a[href="/dashboard/translator"]');
    expect(translator).not.toBeNull();
    await act(async () => translator.click());
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await act(async () => trigger.click());
    expect(document.querySelector("dialog[open]")).not.toBeNull();
    await act(async () =>
      document.querySelector('dialog button[aria-label="Close"]').click(),
    );
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

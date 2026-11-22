// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard/token-saver", redirect: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }) => React.createElement("a", { href, ...props }, children) }));
vi.mock("@/store/settingsStore", () => ({ default: Object.assign((selector) => selector({ settings: { showUpdateNotifications: false } }), { getState: () => ({ fetchSettings: vi.fn() }) }) }));
vi.mock("@/shared/ui/v5/motion/MotionIcon.jsx", () => ({ default: ({ name }) => React.createElement("span", { "data-motion-icon": name, "aria-hidden": "true" }) }));
vi.mock("@/shared/components/UpdatePanel", () => ({ default: () => null }));
import Sidebar from "../../src/shared/components/Sidebar.js";
import LanguageSwitcher from "../../src/shared/components/LanguageSwitcher.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
let container;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  root = null;
  document.documentElement.removeAttribute("data-ui");
  vi.unstubAllGlobals();
});
async function render(element, enabled) {
  if (enabled) document.documentElement.dataset.ui = "v5";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(element));
}

it.each([false, true])("renders navigation with V5 %s", async (enabled) => {
  await render(React.createElement(Sidebar, { onClose: vi.fn() }), enabled);
  const nav = container.querySelector('aside[aria-label="Dashboard navigation"]');
  const active = nav.querySelector('a[aria-current="page"]');
  expect(active.textContent).toContain(enabled ? "Dashboard" : "Statistics");
  expect(nav.textContent).not.toContain("My dashboards");
  expect(active.querySelector("[data-motion-icon]" )?.getAttribute("data-motion-icon")).toBe(enabled ? "token_saver_stats" : undefined);
  expect(nav.querySelector('button[aria-expanded="true"]')).not.toBeNull();
  expect(active.className).toContain("focus-visible:");
});

it.each([false, true])("keeps language names and failure feedback accessible with V5 %s", async (enabled) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
  await render(React.createElement(LanguageSwitcher), enabled);
  const trigger = container.querySelector('button[title="Language"]');
  expect(trigger.textContent).toContain("English");
  expect(trigger.lastElementChild.getAttribute("aria-hidden")).toBe(enabled ? "true" : null);
  await act(async () => trigger.click());
  const french = [...document.querySelectorAll("button")].find((button) => button.title === "Français");
  expect(french).toBeTruthy();
  expect(french.querySelector('[aria-hidden="true"]')).not.toBeNull();
  await act(async () => french.click());
  expect(document.querySelector('[role="alert"]').textContent).toContain("500");
});

it.each([false, true])("traps drawer focus and returns it after Escape with V5 %s", async (enabled) => {
  const { default: Drawer } = await import("../../src/shared/ui/components/Drawer.jsx");
  function Fixture() {
    const [open, setOpen] = React.useState(false);
    return React.createElement(React.Fragment, null,
      React.createElement("button", { onClick: () => setOpen(true) }, "Open navigation"),
      React.createElement(Drawer, { open, onClose: () => setOpen(false), title: "Navigation" },
        React.createElement("button", null, "Last action")));
  }
  await render(React.createElement(Fixture), enabled);
  const opener = container.querySelector("button");
  opener.focus();
  await act(async () => opener.click());
  const dialog = document.querySelector("dialog[open]");
  expect(dialog).not.toBeNull();
  const last = [...dialog.querySelectorAll("button")].at(-1);
  last.focus();
  await act(async () => last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
  expect(dialog.contains(document.activeElement)).toBe(true);
  await act(async () => dialog.dispatchEvent(new Event("cancel", { bubbles: false, cancelable: true })));
  expect(document.querySelector("dialog[open]")).toBeNull();
  expect(document.activeElement).toBe(opener);
});

it("disables language choices while saving", async () => {
  let finish;
  vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => { finish = resolve; })));
  await render(React.createElement(LanguageSwitcher), true);
  await act(async () => container.querySelector('button[title="Language"]').click());
  const french = [...document.querySelectorAll("button")].find((button) => button.title === "Français");
  await act(async () => french.click());
  expect(french.disabled).toBe(true);
  await act(async () => finish({ ok: false, status: 500 }));
  expect(french.disabled).toBe(false);
});

it("preserves the incumbent navigation labels when V5 is off", async () => {
  await render(React.createElement(Sidebar), false);
  const nav = container.querySelector("nav");
  const labels = [...nav.querySelectorAll("a, button")].map((node) => node.querySelector("span:not([aria-hidden])")?.textContent).filter(Boolean);
  expect(labels).toEqual(["Usage", "Timeline", "Quota Tracker", "Health", "Console Log", "Playground", "Combos", "Providers", "Endpoint", "API Keys", "Proxy Pools", "Token Saver", "Statistics", "Settings", "Headroom", "Test Savers", "MCP Gateway", "CLI Tools", "Skills", "Auto-configure", "Media Providers", "Media Routes", "Docs"]);
});

it("redirects the dashboard root to usage", async () => {
  const { redirect } = await import("next/navigation");
  const { default: DashboardPage } = await import("../../src/app/(dashboard)/dashboard/page.js");
  DashboardPage();
  expect(redirect).toHaveBeenCalledWith("/dashboard/usage");
});

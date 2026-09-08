// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import Link from "../../.storybook/next-link.jsx";
import { installStoryNavigation } from "../../.storybook/next-navigation.js";

it("keeps local navigation in fixture history and preserves prevented/modified clicks", async () => {
 const cleanup = installStoryNavigation({ pathname: "/dashboard" });
 const node = document.createElement("div"); document.body.append(node);
 const root = createRoot(node);
 try {
  await act(async () => root.render(React.createElement(Link, { href: { pathname: "/dashboard/providers", query: { tag: ["a", "b"] }, hash: "#models" } }, "Providers")));
  const link = node.querySelector("a");
  expect(link.getAttribute("href")).toBe("/dashboard/providers?tag=a&tag=b#models");
  await act(async () => link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
  expect(globalThis.__STORYBOOK_NAV__.__current()).toContain("/dashboard/providers?tag=a&tag=b#models");
  const before = globalThis.__STORYBOOK_NAV__.__current();
  const stop = vi.fn((event) => event.preventDefault());
  await act(async () => root.render(React.createElement(Link, { href: "/blocked", onClick: stop }, "Blocked")));
  await act(async () => node.querySelector("a").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
  expect(stop).toHaveBeenCalledOnce();
  expect(globalThis.__STORYBOOK_NAV__.__current()).toBe(before);
 } finally { await act(async () => root.unmount()); node.remove(); await cleanup(); }
});

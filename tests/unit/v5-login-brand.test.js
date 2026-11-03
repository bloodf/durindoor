// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
vi.mock("@/shared/ui/v5/login/GateScene.jsx", () => ({ default: () => null }));
import { ReviewLoginView } from "@/shared/ui/v5/login/ReviewLoginView.jsx";
import ReviewIconHelp from "@/shared/ui/v5/motion/ReviewIconHelp.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
it("explains the actual login emblem while preserving its brand artwork", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  document.documentElement.dataset.v5Review = "true";
  try {
    act(() => root.render(React.createElement(React.Fragment, null,
      React.createElement(ReviewLoginView, { authMode: "password", passwordAvailable: true, hasPassword: true, password: "", setPassword: vi.fn() }), React.createElement(ReviewIconHelp))));
    const logo = host.querySelector('[role="img"][aria-label="DurinDoor logo"]');
    expect(logo).not.toBeNull();
    expect(logo.querySelectorAll("svg path")).toHaveLength(3);
    await act(async () => logo.querySelector("path").dispatchEvent(new Event("pointerover", { bubbles: true })));
    expect(document.querySelector('[role="tooltip"]').textContent).toBe("DurinDoor logo");
  } finally { act(() => root.unmount()); host.remove(); delete document.documentElement.dataset.v5Review; }
});

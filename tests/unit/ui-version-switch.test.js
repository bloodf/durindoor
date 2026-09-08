// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import CurrentSwitch from "@/shared/components/UiVersionSwitch";
import LegacySwitch from "@/legacy/shared/components/UiVersionSwitch";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mounted = [];

async function render(Component) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(Component)));
  mounted.push({ container, root });
  return container;
}

const click = async (container, label) => {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === label);
  expect(button, `${label} button is rendered`).toBeTruthy();
  await act(async () => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  return button;
};

describe.each([["current tree", CurrentSwitch], ["legacy tree", LegacySwitch]])("dashboard version switch (%s)", (_label, Switch) => {
  beforeEach(() => {
    document.cookie = "durindoor-ui-version=; path=/; max-age=0";
    vi.stubGlobal("location", { reload: vi.fn() });
  });

  afterEach(async () => {
    for (const { container, root } of mounted.splice(0)) {
      await act(async () => root.unmount());
      container.remove();
    }
    vi.unstubAllGlobals();
  });

  it("opts into the new dashboard and reloads so the server can honour it", async () => {
    // The choice is server-side, so writing the cookie without reloading
    // would leave the reader on the page they were trying to leave.
    const container = await render(Switch);
    await click(container, "New UI");
    expect(document.cookie).toContain("durindoor-ui-version=new");
    expect(window.location.reload).toHaveBeenCalled();
  });

  it("returns to the current dashboard", async () => {
    document.cookie = "durindoor-ui-version=new; path=/";
    const container = await render(Switch);
    await click(container, "Old UI");
    expect(document.cookie).toContain("durindoor-ui-version=legacy");
    expect(window.location.reload).toHaveBeenCalled();
  });

  it("shows which dashboard is active", async () => {
    document.cookie = "durindoor-ui-version=new; path=/";
    const container = await render(Switch);
    const pressed = [...container.querySelectorAll("button")].filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed.map((b) => b.textContent.trim())).toEqual(["New UI"]);
  });

  it("does not reload when the active option is chosen again", async () => {
    const container = await render(Switch);
    await click(container, "Old UI");
    expect(window.location.reload).not.toHaveBeenCalled();
  });
});

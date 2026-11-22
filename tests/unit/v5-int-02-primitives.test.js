// @vitest-environment happy-dom
import React, { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import Button from "../../src/shared/ui/components/Button.jsx";
import Tooltip from "../../src/shared/ui/components/Tooltip.jsx";
import Pagination from "../../src/shared/ui/components/Pagination.jsx";
import { V5NativeSelect } from "../../src/shared/ui/v5/NativeSelect.jsx";

vi.mock("motion/react", async (importOriginal) => ({ ...await importOriginal(), useReducedMotion: () => true }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, host;
async function render(element, enabled) {
  document.documentElement.dataset.ui = enabled ? "v5" : "";
  host = document.createElement("div"); document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(element));
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove(); root = null; delete document.documentElement.dataset.ui;
});
for (const enabled of [false, true]) {
  it(`preserves form button semantics and loading with V5 ${enabled}`, async () => {
    const ref = createRef(); const submit = vi.fn((event) => event.preventDefault());
    await render(React.createElement("form", { onSubmit: submit }, React.createElement(Button, { type: "submit", ref }, "Save")), enabled);
    const button = host.querySelector("button");
    expect(ref.current).toBe(button); expect(button.type).toBe("submit");
    await act(async () => button.click()); expect(submit).toHaveBeenCalledOnce();
    await act(async () => root.render(React.createElement(Button, { loading: true }, "Saving")));
    expect(host.querySelector("button").disabled).toBe(true);
    expect(host.querySelector("button").getAttribute("aria-busy")).toBe("true");
  });
  it(`keeps native select form value and required validation with V5 ${enabled}`, async () => {
    await render(React.createElement("form", null, React.createElement(V5NativeSelect, { name: "choice", required: true, defaultValue: "" }, React.createElement("option", { value: "" }, "Choose"), React.createElement("option", { value: "a" }, "A"))), enabled);
    const form = host.querySelector("form"); const select = form.querySelector("select");
    expect(form.checkValidity()).toBe(false); expect(new FormData(form).get("choice")).toBe("");
    if (!enabled) { select.value = "a"; select.dispatchEvent(new Event("change", { bubbles: true })); }
    else {
      const trigger = host.querySelector('[role="combobox"]');
      await act(async () => trigger.click());
      const option = [...document.querySelectorAll('[role="option"]')].find((el) => el.textContent === "A");
      await act(async () => option.click());
    }
    expect(new FormData(form).get("choice")).toBe("a"); expect(form.checkValidity()).toBe(true);
  });
  it(`keeps pagination named and navigable with V5 ${enabled}`, async () => {
    const onPage = vi.fn();
    await render(React.createElement(Pagination, { page: 1, pageCount: 2, total: 0, onPage }), enabled);
    expect(host.querySelector('[aria-label="Previous page"]').disabled).toBe(true);
    expect(host.textContent).toContain("0 results");
    await act(async () => host.querySelector('[aria-label="Next page"]').click());
    expect(onPage).toHaveBeenCalledWith(2);
  });
}
it("opens V5 help for an icon and dismisses with Escape", async () => {
  await render(React.createElement(Tooltip, { content: "Help text" }, React.createElement("button", { "aria-label": "Help" }, React.createElement("span", { className: "material-symbols-outlined" }, "help"), "Label")), true);
  const button = host.querySelector("button"), icon = button.querySelector("span"), tooltip = host.querySelector('[role="tooltip"]');
  await act(async () => button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  expect(tooltip.className).toContain("invisible");
  await act(async () => icon.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  expect(tooltip.className).toContain("opacity-100");
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(tooltip.className).toContain("invisible");
});

it("renders loading icon without animation when motion is reduced", async () => {
  await render(React.createElement(Button, { loading: true }, "Loading"), true);
  expect(host.querySelector('[data-icon-name="progress_activity"]').className).not.toContain("animate-spin");
});

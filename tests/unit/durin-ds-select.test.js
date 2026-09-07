// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Select from "../../src/shared/ui/components/Select.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const e = React.createElement;

const OPTIONS = [
  { value: "anthropic", label: "Anthropic" },
  { value: "openai", label: "OpenAI", icon: "auto_awesome" },
  { value: "google", label: "Google", hint: "Long context" },
  { value: "disabled", label: "Disabled", disabled: true },
];

async function render(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  return { container, root };
}

async function dispose(root, container) {
  await act(async () => root.unmount());
  container.remove();
}

function fireKey(target, key) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

function listbox() {
  return document.body.querySelector('ul[role="listbox"]');
}

function getTrigger(container) {
  return container.querySelector('[role="combobox"]');
}

describe("Durin DS Select", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  it("renders a combobox trigger with forwarded attributes", async () => {
    const { container, root } = await render(
      e(Select, { options: OPTIONS, name: "provider", "aria-describedby": "provider-hint", "aria-label": "Provider" })
    );
    const trigger = getTrigger(container);
    expect(trigger).toBeTruthy();
    expect(trigger.tagName).toBe("BUTTON");
    // role="combobox" carries an implicit aria-haspopup="listbox" (ARIA 1.2),
    // so assert the role a consumer observes, not the redundant attribute.
    expect(trigger.getAttribute("role")).toBe("combobox");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("name")).toBe("provider");
    expect(trigger.getAttribute("aria-describedby")).toBe("provider-hint");
    await dispose(root, container);
  });

  it("navigates active option then selects with Enter", async () => {
    const onChange = vi.fn();
    const { container, root } = await render(
      e(Select, { options: OPTIONS, value: "anthropic", onChange, "aria-label": "Provider" })
    );
    const trigger = getTrigger(container);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    await act(async () => fireKey(trigger, "ArrowDown"));
    expect(document.body.contains(listbox())).toBe(true);
    expect(trigger.getAttribute("aria-activedescendant")).toContain("option-0");

    await act(async () => fireKey(trigger, "ArrowDown"));
    const active = document.getElementById(trigger.getAttribute("aria-activedescendant"));
    expect(active.textContent).toContain("OpenAI");
    expect(active.getAttribute("aria-selected")).toBe("false");

    await act(async () => fireKey(trigger, "Enter"));
    expect(onChange).toHaveBeenCalledWith("openai");
    expect(listbox()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await dispose(root, container);
  });

  it("skips disabled options; Home/End target enabled bounds", async () => {
    const { container, root } = await render(e(Select, { options: OPTIONS, "aria-label": "Provider" }));
    const trigger = getTrigger(container);
    await act(async () => trigger.click());
    await act(async () => fireKey(trigger, "End"));
    expect(trigger.getAttribute("aria-activedescendant")).toContain("option-2");
    await act(async () => fireKey(trigger, "Home"));
    expect(trigger.getAttribute("aria-activedescendant")).toContain("option-0");
    await act(async () => fireKey(trigger, "ArrowDown"));
    expect(trigger.getAttribute("aria-activedescendant")).toContain("option-1");
    await dispose(root, container);
  });

  it("typeahead moves active option without choosing it", async () => {
    const onChange = vi.fn();
    const { container, root } = await render(e(Select, { options: OPTIONS, onChange, "aria-label": "Provider" }));
    const trigger = getTrigger(container);
    await act(async () => trigger.click());
    await act(async () => fireKey(trigger, "g"));
    expect(trigger.getAttribute("aria-activedescendant")).toContain("option-2");
    expect(onChange).not.toHaveBeenCalled();
    await dispose(root, container);
  });

  it("Escape cancels and Tab exits without mutation", async () => {
    const onChange = vi.fn();
    const { container, root } = await render(
      e(React.Fragment, null,
        e(Select, { options: OPTIONS, value: "anthropic", onChange, "aria-label": "Provider" }),
        e("button", { type: "button" }, "Next"))
    );
    const trigger = getTrigger(container);
    await act(async () => trigger.click());
    await act(async () => fireKey(trigger, "ArrowDown"));
    await act(async () => fireKey(trigger, "Escape"));
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger.textContent).toContain("Anthropic");
    expect(listbox()).toBeNull();
    expect(document.activeElement).toBe(trigger);

    await act(async () => trigger.click());
    expect(listbox()).toBeTruthy();
    await act(async () => fireKey(trigger, "Tab"));
    expect(listbox()).toBeNull();
    await dispose(root, container);
  });

  it("does not open when disabled and shows empty list state", async () => {
    const { container, root } = await render(
      e(React.Fragment, null,
        e(Select, { options: OPTIONS, disabled: true, "aria-label": "Disabled" }),
        e(Select, { options: [], "aria-label": "Empty" }))
    );
    const triggers = container.querySelectorAll('[role="combobox"]');
    const [disabledTrigger, emptyTrigger] = triggers;
    expect(disabledTrigger.hasAttribute("disabled")).toBe(true);
    await act(async () => disabledTrigger.click());
    expect(listbox()).toBeNull();
    await act(async () => emptyTrigger.click());
    expect(listbox().textContent).toContain("No options");
    await dispose(root, container);
  });
});

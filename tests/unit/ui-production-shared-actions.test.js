// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Button from "../../src/shared/components/Button.js";
import Input from "../../src/shared/components/Input.js";
import Select from "../../src/shared/components/Select.js";
import Toggle from "../../src/shared/components/Toggle.js";
import SegmentedControl from "../../src/shared/components/SegmentedControl.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const e = React.createElement;

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

async function fireKey(target, key) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

describe("Durin DS production — shared-actions lane", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("Button: disables while loading and does not click", async () => {
    const onClick = vi.fn();
    const { container, root } = await render(
      e(Button, { loading: true, onClick }, "Delete")
    );
    const button = container.querySelector("button");
    expect(button.disabled).toBe(true);
    button.click();
    expect(onClick).not.toHaveBeenCalled();
    await dispose(root, container);
  });

  it("Button: clicks when enabled", async () => {
    const onClick = vi.fn();
    const { container, root } = await render(
      e(Button, { onClick }, "Save")
    );
    const button = container.querySelector("button");
    await act(async () => button.click());
    expect(onClick).toHaveBeenCalledTimes(1);
    await dispose(root, container);
  });

  it("Input: surfaces error state with role=alert and aria-invalid wiring", async () => {
    const { container, root } = await render(
      e(Input, { label: "API key", error: "Invalid key", required: true })
    );
    const input = container.querySelector("input");
    const alert = container.querySelector('[role="alert"]');
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(alert.id);
    expect(alert.textContent).toContain("Invalid key");
    await dispose(root, container);
  });

  it("Select: opens on click, moves with ArrowDown, selects with Enter emitting {target:{value}}", async () => {
    const onChange = vi.fn();
    const options = [
      { value: "anthropic", label: "Anthropic" },
      { value: "openai", label: "OpenAI" },
      { value: "google", label: "Google", disabled: true },
    ];
    const { container, root } = await render(
      e(Select, { options, value: "anthropic", onChange, "aria-label": "Provider" })
    );
    const trigger = container.querySelector('[role="combobox"]');
    await act(async () => trigger.click());
    await fireKey(trigger, "ArrowDown");
    await fireKey(trigger, "Enter");
    expect(onChange).toHaveBeenCalledWith({ target: { value: "openai" } });
    await dispose(root, container);
  });

  it("Select: skips disabled options via ArrowDown", async () => {
    const onChange = vi.fn();
    const options = [
      { value: "a", label: "A" },
      { value: "b", label: "B", disabled: true },
      { value: "c", label: "C" },
    ];
    const { container, root } = await render(
      e(Select, { options, value: "a", onChange, "aria-label": "Choice" })
    );
    const trigger = container.querySelector('[role="combobox"]');
    await act(async () => trigger.click());
    await fireKey(trigger, "ArrowDown");
    await fireKey(trigger, "Enter");
    expect(onChange).toHaveBeenCalledWith({ target: { value: "c" } });
    await dispose(root, container);
  });

  it("Toggle: clicking emits inverse boolean and honors disabled", async () => {
    const onChange = vi.fn();
    const { container, root } = await render(
      e(Toggle, { checked: false, onChange, ariaLabel: "Live updates" })
    );
    const button = container.querySelector('[role="switch"]');
    await act(async () => button.click());
    expect(onChange).toHaveBeenCalledWith(true);
    await dispose(root, container);

    const onChangeDisabled = vi.fn();
    const disabledRender = await render(
      e(Toggle, { checked: true, disabled: true, onChange: onChangeDisabled, ariaLabel: "Disabled" })
    );
    const disabledButton = disabledRender.container.querySelector('[role="switch"]');
    await act(async () => disabledButton.click());
    expect(onChangeDisabled).not.toHaveBeenCalled();
    await dispose(disabledRender.root, disabledRender.container);
  });

  it("SegmentedControl: ArrowRight moves radiogroup selection, skipping disabled segments", async () => {
    const onChange = vi.fn();
    const options = [
      { value: "1d", label: "1D" },
      { value: "7d", label: "7D", disabled: true },
      { value: "1m", label: "1M" },
    ];
    const { container, root } = await render(
      e(SegmentedControl, { options, value: "1d", onChange })
    );
    const group = container.querySelector('[role="radiogroup"]');
    await fireKey(group, "ArrowRight");
    expect(onChange).toHaveBeenCalledWith("1m");
    await dispose(root, container);
  });
});

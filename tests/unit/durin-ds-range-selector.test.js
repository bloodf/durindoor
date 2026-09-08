// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import RangeSelector, { rangeLabel } from "../../src/shared/ui/components/RangeSelector.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function mount(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  await act(async () => {
    await flush();
  });
  return {
    container,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function getByText(container, text) {
  return Array.from(container.querySelectorAll("button")).find((node) => node.textContent.trim() === text);
}

function setDateInput(input, isoValue) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, isoValue);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function findCustomTrigger(container) {
  return Array.from(container.querySelectorAll("button")).find((node) => node.getAttribute("aria-haspopup") === "dialog");
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("rangeLabel", () => {
  it("returns preset label for known presets", () => {
    expect(rangeLabel({ preset: "7d" })).toBe("Last 7 days");
  });

  it("falls back when preset is unknown", () => {
    expect(rangeLabel({ preset: "nope" })).toBe("Date range");
  });

  it("summarises a custom range with two different days", () => {
    expect(rangeLabel({ preset: "custom", from: "2026-05-01", to: "2026-08-30" })).toBe("May 1 – Aug 30");
  });

  it("collapses same-day custom ranges to a single date", () => {
    expect(rangeLabel({ preset: "custom", from: "2026-05-01", to: "2026-05-01" })).toBe("May 1");
  });

  it("returns generic label for partial custom data", () => {
    expect(rangeLabel({ preset: "custom", from: "2026-05-01" })).toBe("Custom range");
  });
});

describe("RangeSelector", () => {
  it("emits a preset change without opening the popover", async () => {
    const onChange = vi.fn();
    const { container, unmount } = await mount(
      React.createElement(RangeSelector, { value: { preset: "7d" }, onChange }),
    );

    await act(async () => getByText(container, "7D").click());

    expect(onChange).toHaveBeenCalledWith({ preset: "7d" });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await unmount();
  });

  it("does not emit while typing in the custom popover and only commits valid Apply", async () => {
    const onChange = vi.fn();
    const { container, unmount } = await mount(
      React.createElement(RangeSelector, { value: { preset: "7d" }, onChange }),
    );

    await act(async () => findCustomTrigger(container).click());
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();

    const [from, to] = container.querySelectorAll('input[type="date"]');
    await act(async () => setDateInput(from, "2026-09-01"));
    await act(async () => setDateInput(to, "2026-09-05"));
    expect(onChange).not.toHaveBeenCalled();

    const apply = Array.from(container.querySelectorAll("button")).find((node) => node.textContent.trim() === "Apply");
    expect(apply.disabled).toBe(false);
    await act(async () => apply.click());

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ preset: "custom", from: "2026-09-01", to: "2026-09-05" });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await unmount();
  });

  it("disables Apply and announces an alert when from is after to, without emitting", async () => {
    const onChange = vi.fn();
    const { container, unmount } = await mount(
      React.createElement(RangeSelector, { value: { preset: "7d" }, onChange }),
    );

    await act(async () => findCustomTrigger(container).click());
    const [from, to] = container.querySelectorAll('input[type="date"]');
    await act(async () => setDateInput(from, "2026-09-10"));
    await act(async () => setDateInput(to, "2026-09-01"));

    const alert = container.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(alert.textContent).toMatch(/start date must be on or before end date/i);
    const apply = Array.from(container.querySelectorAll("button")).find((node) => node.textContent.trim() === "Apply");
    expect(apply.disabled).toBe(true);
    expect(from.getAttribute("aria-invalid")).toBe("true");
    expect(onChange).not.toHaveBeenCalled();
    await unmount();
  });

  it("does not emit on Cancel and returns focus to the trigger", async () => {
    const onChange = vi.fn();
    const { container, unmount } = await mount(
      React.createElement(RangeSelector, { value: { preset: "1m" }, onChange }),
    );

    const custom = findCustomTrigger(container);
    custom.focus();
    await act(async () => custom.click());
    expect(document.activeElement).toBe(container.querySelector('input[type="date"]'));

    const cancel = Array.from(container.querySelectorAll("button")).find((node) => node.textContent.trim() === "Cancel");
    await act(async () => cancel.click());

    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(custom);
    await unmount();
  });

  it("closes on Escape without emitting and returns focus to the trigger", async () => {
    const onChange = vi.fn();
    const { container, unmount } = await mount(
      React.createElement(RangeSelector, { value: { preset: "1m" }, onChange }),
    );

    const custom = findCustomTrigger(container);
    await act(async () => custom.click());
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(custom);
    expect(onChange).not.toHaveBeenCalled();
    await unmount();
  });

  it("closes without emitting on a background outside click and returns focus to the trigger", async () => {
    const onChange = vi.fn();
    const background = document.createElement("div");
    document.body.appendChild(background);
    const { container, unmount } = await mount(
      React.createElement(RangeSelector, { value: { preset: "1m" }, onChange }),
    );

    const custom = findCustomTrigger(container);
    await act(async () => custom.click());
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();

    await act(async () => {
      background.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(custom);
    background.remove();
    await unmount();
  });

  it("closes on an outside click into another focusable control without stealing its focus", async () => {
    const onChange = vi.fn();
    const otherButton = document.createElement("button");
    otherButton.textContent = "Other control";
    document.body.appendChild(otherButton);
    const { container, unmount } = await mount(
      React.createElement(RangeSelector, { value: { preset: "1m" }, onChange }),
    );

    const custom = findCustomTrigger(container);
    await act(async () => custom.click());
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();

    await act(async () => {
      otherButton.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      otherButton.focus();
    });

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(otherButton);
    otherButton.remove();
    await unmount();
  });
});

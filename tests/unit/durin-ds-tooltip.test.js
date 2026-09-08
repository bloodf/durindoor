// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Tooltip from "../../src/shared/ui/components/Tooltip.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function renderTooltip(root, props = {}, triggerProps = {}) {
  root.render(
    React.createElement(
      Tooltip,
      { content: "Describes this control", ...props },
      React.createElement("button", { type: "button", ...triggerProps }, "Trigger"),
    ),
  );
}

function isVisible(tooltip) {
  return !tooltip.className.includes("invisible");
}

describe("Durin DS Tooltip", () => {
  let container;
  let root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("associates description with trigger and shows it on focus", async () => {
    const onFocus = vi.fn();
    await act(async () => renderTooltip(root, {}, { "aria-describedby": "existing-description", onFocus }));
    const button = container.querySelector("button");
    const descriptionIds = button.getAttribute("aria-describedby").split(" ");
    const tooltip = document.getElementById(descriptionIds.at(-1));

    expect(descriptionIds).toContain("existing-description");
    expect(tooltip.getAttribute("role")).toBe("tooltip");
    expect(isVisible(tooltip)).toBe(false);

    await act(async () => button.focus());
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(isVisible(tooltip)).toBe(true);
    expect(tooltip.textContent).toContain("Describes this control");
  });

  it("keeps tooltip open while focused even after pointer leaves, and vice versa", async () => {
    await act(async () => renderTooltip(root));
    const button = container.querySelector("button");
    const tooltip = document.getElementById(button.getAttribute("aria-describedby"));

    await act(async () => {
      button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: null }));
      button.focus();
    });
    expect(isVisible(tooltip)).toBe(true);

    // Pointer leaves but focus remains: tooltip must stay open.
    await act(async () => {
      button.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
      vi.advanceTimersByTime(200);
    });
    expect(isVisible(tooltip)).toBe(true);

    // Focus also leaves: only now does it hide.
    await act(async () => button.blur());
    await act(async () => vi.advanceTimersByTime(200));
    expect(isVisible(tooltip)).toBe(false);
  });

  it("repositions an open tooltip when side changes", async () => {
    await act(async () => renderTooltip(root, { side: "top" }));
    const trigger = container.querySelector("span");
    const tooltip = document.getElementById(container.querySelector("button").getAttribute("aria-describedby"));
    trigger.getBoundingClientRect = () => ({ left: 100, top: 100, right: 150, bottom: 130, width: 50, height: 30 });
    tooltip.getBoundingClientRect = () => ({ width: 60, height: 20 });

    await act(async () => container.querySelector("button").focus());
    expect(tooltip.style.top).toBe("72px");

    await act(async () => renderTooltip(root, { side: "bottom" }));
    expect(tooltip.style.top).toBe("138px");
  });

  it("keeps unexpected native dismissal until trigger presence ends", async () => {
    const descriptors = Object.fromEntries(
      ["popover", "showPopover", "hidePopover", "matches"].map((key) => [
        key,
        Object.getOwnPropertyDescriptor(HTMLElement.prototype, key),
      ]),
    );
    let shown = false;
    const toggle = (target, newState) => {
      const event = new Event("toggle");
      Object.defineProperty(event, "newState", { value: newState });
      target.dispatchEvent(event);
    };

    Object.defineProperties(HTMLElement.prototype, {
      popover: { configurable: true, value: "manual" },
      showPopover: {
        configurable: true,
        value() {
          shown = true;
          toggle(this, "open");
        },
      },
      hidePopover: {
        configurable: true,
        value() {
          shown = false;
          toggle(this, "closed");
        },
      },
      matches: {
        configurable: true,
        value(selector) {
          return selector === ":popover-open" && shown;
        },
      },
    });

    try {
      await act(async () => renderTooltip(root));
      const button = container.querySelector("button");
      const tooltip = document.getElementById(button.getAttribute("aria-describedby"));

      await act(async () => button.focus());
      expect(isVisible(tooltip)).toBe(true);
      await act(async () => button.blur());
      await act(async () => vi.advanceTimersByTime(200));
      await act(async () => button.focus());
      expect(isVisible(tooltip)).toBe(true);

      await act(async () => {
        shown = false;
        toggle(tooltip, "closed");
      });
      expect(isVisible(tooltip)).toBe(false);

      await act(async () => button.blur());
      await act(async () => vi.advanceTimersByTime(200));
      await act(async () => button.focus());
      expect(isVisible(tooltip)).toBe(true);
    } finally {
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor);
        else delete HTMLElement.prototype[key];
      }
    }
  });

  it("dismisses on Escape until every presence ends, then reopens on next hover", async () => {
    await act(async () => renderTooltip(root));
    const button = container.querySelector("button");
    const tooltip = document.getElementById(button.getAttribute("aria-describedby"));

    await act(async () => button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: null })));
    expect(isVisible(tooltip)).toBe(true);

    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(isVisible(tooltip)).toBe(false);

    // Still hovered: stays dismissed.
    await act(async () => vi.advanceTimersByTime(200));
    expect(isVisible(tooltip)).toBe(false);

    // Presence ends and restarts: dismissal clears, tooltip can reopen.
    await act(async () => {
      button.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
      vi.advanceTimersByTime(200);
    });
    await act(async () => button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: null })));
    expect(isVisible(tooltip)).toBe(true);
  });
});

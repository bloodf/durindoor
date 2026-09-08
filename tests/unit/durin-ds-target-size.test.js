// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import Button from "../../src/shared/ui/components/Button.jsx";
import IconButton from "../../src/shared/ui/components/IconButton.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots = [];

async function mount(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push({ container, root });
  await act(async () => {
    root.render(element);
  });
  return container;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(({ container, root }) =>
      act(async () => {
        root.unmount();
        container.remove();
      }),
    ),
  );
});

describe("Durin DS button interaction contracts", () => {
  it("activates enabled Button once and defaults to type=button", async () => {
    const onClick = vi.fn();
    const container = await mount(
      React.createElement(Button, { onClick }, "Save"),
    );
    const button = container.querySelector("button");

    expect(button.type).toBe("button");
    await act(async () => button.click());

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not activate disabled or busy Buttons", async () => {
    const onClick = vi.fn();
    const container = await mount(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(Button, { disabled: true, onClick }, "Disabled"),
        React.createElement(Button, { loading: true, onClick }, "Saving"),
      ),
    );
    const buttons = container.querySelectorAll("button");

    await act(async () => {
      buttons.forEach((button) => button.click());
    });

    expect(onClick).not.toHaveBeenCalled();
    expect(container.querySelectorAll("button:disabled")).toHaveLength(2);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("does not submit a form while a busy submit Button is clicked", async () => {
    const onSubmit = vi.fn((event) => event.preventDefault());
    const container = await mount(
      React.createElement(
        "form",
        { onSubmit },
        React.createElement(Button, { type: "submit", loading: true }, "Save"),
      ),
    );

    await act(async () => container.querySelector("button").click());

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("activates enabled IconButton once and ignores disabled ones", async () => {
    const onClick = vi.fn();
    const container = await mount(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(IconButton, {
          icon: "refresh",
          label: "Refresh status",
          onClick,
        }),
        React.createElement(IconButton, {
          icon: "delete",
          label: "Delete",
          disabled: true,
          onClick,
        }),
      ),
    );
    const buttons = container.querySelectorAll("button");

    expect(buttons[0].type).toBe("button");
    expect(buttons[0].getAttribute("aria-label")).toBe("Refresh status");
    expect(buttons[0].querySelector("span")?.getAttribute("aria-hidden")).toBe("true");
    expect(buttons[1].disabled).toBe(true);

    await act(async () => {
      buttons.forEach((button) => button.click());
    });

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

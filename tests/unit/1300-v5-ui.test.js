// @vitest-environment happy-dom
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import ProviderRpmControl from "../../src/app/(dashboard)/dashboard/providers/[id]/ProviderRpmControl.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it("keeps the provider RPM control labeled and saves the edited value on blur", async () => {
  const save = vi.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  function Fixture() {
    const [value, setValue] = useState("12");
    return React.createElement(ProviderRpmControl, { value, placeholder: "60", max: 100, onChange: setValue, onSave: save });
  }
  try {
    await act(async () => root.render(React.createElement(Fixture)));
    const label = container.querySelector("label");
    const input = container.querySelector("input");
    expect(label.control).toBe(input);
    expect(label.textContent).toBe("RPM / account");
    expect(label.className).not.toMatch(/\bhidden\b/);
    expect(input.min).toBe("0");
    expect(input.max).toBe("100");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, "24");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(input.value).toBe("24");
    expect(save).not.toHaveBeenCalled();
    await act(async () => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(save).toHaveBeenCalledWith("24");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

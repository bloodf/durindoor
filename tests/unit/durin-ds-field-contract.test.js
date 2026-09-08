// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import Field from "@/shared/ui/components/Field.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Checkbox from "@/shared/ui/components/Checkbox.jsx";

it("associates external labels and preserves native descriptions and invalid state", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(React.Fragment, null,
      React.createElement("p", { id: "extra-help" }, "Existing description"),
      React.createElement(Field, { label: "Account", hint: "Choose account" },
        React.createElement(Input, { "aria-describedby": "extra-help", "aria-invalid": true })),
      React.createElement(Field, { label: "Consent", hint: "Required agreement" },
        React.createElement(Checkbox, { "aria-invalid": true })))));
    const inputs = container.querySelectorAll("input");
    const labels = [...container.querySelectorAll("label")];
    expect(labels.find((label) => label.textContent === "Account").control).toBe(inputs[0]);
    expect(labels.find((label) => label.textContent === "Consent").control).toBe(inputs[1]);
    for (const input of inputs) {
      expect(input.getAttribute("aria-invalid")).toBe("true");
      const ids = input.getAttribute("aria-describedby").split(/\s+/);
      expect(ids.every((id) => document.getElementById(id))).toBe(true);
    }
    expect(inputs[0].getAttribute("aria-describedby").split(/\s+/)).toContain("extra-help");
    expect(inputs[0].labels[0].textContent).toBe("Account");
    expect([...inputs[1].labels].some((label) => label.textContent === "Consent")).toBe(true);
    await act(async () => root.render(React.createElement(Field, { group: true, label: "Notifications", hint: "Choose alerts" },
      React.createElement("div", null,
        React.createElement(Checkbox, { label: "Usage" }),
        React.createElement(Checkbox, { label: "Errors" })))));
    const fieldset = container.querySelector("fieldset");
    expect(fieldset.querySelector("legend").textContent).toBe("Notifications");
    expect(container.querySelector("label[for='Notifications']")).toBeNull();
    expect([...fieldset.querySelectorAll("input")].map((input) => input.labels[0].textContent)).toEqual(["Usage", "Errors"]);
    expect(document.getElementById(fieldset.getAttribute("aria-describedby")).textContent).toBe("Choose alerts");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

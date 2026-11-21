import React from "react";
import { expect, fn, within } from "storybook/test";

import ProviderRpmControl from "./ProviderRpmControl";

const meta = {
  title: "Production/providers/ProviderRpmControl",
  component: ProviderRpmControl,
  args: {
    value: "12",
    placeholder: "60",
    max: 100,
    onChange: fn(),
    onSave: fn(),
  },
  parameters: {
    layout: "padded",
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers/openai",
      params: { id: "openai" },
    },
  },
};

export default meta;

/** The RPM label stays with the field at every width. */
export const Loaded = {
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    const input = view.getByRole("spinbutton", { name: "RPM / account" });
    await expect(input).toHaveValue(12);
    await expect(input).toHaveAttribute("max", "100");
    await expect(input.className).toContain("focus-visible:shadow-dd-focus");
    await expect(input.className).toContain("min-h-11");
  },
};

/** A blank value keeps the label and the provider-default placeholder. */
export const Empty = {
  args: { value: "" },
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole("spinbutton", { name: "RPM / account" });
    await expect(input).toHaveValue(null);
    await expect(input).toHaveAttribute("placeholder", "60");
  },
};

/** A value past the maximum stays labelled; the native max stays on the field. */
export const LimitError = {
  args: { value: "999" },
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole("spinbutton", { name: "RPM / account" });
    await expect(input).toHaveValue(999);
    await expect(input).toHaveAttribute("max", "100");
    await expect(input.labels[0].textContent).toBe("RPM / account");
  },
};

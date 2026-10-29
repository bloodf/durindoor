import React from "react";
import { expect, within } from "storybook/test";
import { CapabilityMatrix } from "./CapabilityMatrix.jsx";

export default { title: "Production/settings/CapabilityMatrix", component: CapabilityMatrix };

export const ActiveAndGated = {
  args: { features: { usage: { enabled: true, requires: 14 }, vector: { enabled: true, requires: 16 } }, effective: { usage: { enabled: true }, vector: { enabled: false } } },
  play: async ({ canvasElement }) => {
    const table = await within(canvasElement).findByRole("table", { name: "Per-feature capability matrix" });
    await expect(within(table).getByText("usage")).toBeVisible();
    await expect(within(table).getByText("active")).toBeVisible();
    await expect(within(table).getByText("off")).toBeVisible();
  },
};

export const Empty = {
  args: { features: {}, effective: {} },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("No features configured")).toBeVisible();
  },
};

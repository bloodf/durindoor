import React from "react";
import { expect, userEvent, within } from "storybook/test";

globalThis.React ??= React;

import { withDashboardShell } from "@/shared/ui/shell/withDashboardShell.jsx";

import HeadroomPage from "./HeadroomPage.jsx";

const meta = {
  title: "Durin DS/Pages/Headroom",
  component: HeadroomPage,
  decorators: [
    withDashboardShell({
      activePath: "/dashboard/headroom",
      title: "Headroom Dashboard",
      subtitle: "Compress outgoing chat messages via the Headroom proxy",
      icon: "compress",
    }),
  ],
  parameters: { layout: "fullscreen" },
};

export default meta;

export const Default = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const rowsSelect = canvas.getByRole("combobox", { name: "Rows per page" });

    await userEvent.selectOptions(rowsSelect, "10");
    await expect(rowsSelect).toHaveValue("10");
    await expect(canvas.getByText("Showing 1 to 2 of 2 results")).toBeInTheDocument();
  },
};

export const CustomRange = {
  args: {
    initialRange: { preset: "custom", from: "2026-08-30", to: "2026-08-31" },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const customButton = canvas.getByRole("button", { name: "Custom" });
    await expect(customButton).toHaveAttribute("aria-pressed", "true");
    await expect(canvas.getByText("Showing 1 to 2 of 2 results")).toBeInTheDocument();
  },
};

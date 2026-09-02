import { expect, userEvent, within } from "storybook/test";

import { withDashboardShell } from "@/shared/ui/shell/withDashboardShell.jsx";

import UsagePage from "./UsagePage.jsx";

const meta = {
  title: "Durin DS/Pages/Usage & Analytics",
  component: UsagePage,
  parameters: { layout: "fullscreen" },
  decorators: [
    withDashboardShell({
      activePath: "/dashboard/usage",
      title: "Usage & Analytics",
      subtitle: "Monitor your API usage, token consumption, and request logs",
      icon: "monitoring",
    }),
  ],
};

export default meta;

/** Fully populated daily usage overview with interactive table filters. */
export const Default = {};

/** Recent requests showing a non-default ten-row page. */
export const TenRows = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const recentSection = canvas.getByRole("heading", { name: "Recent requests" }).closest("section");
    const rowsPerPage = within(recentSection).getByRole("combobox", { name: "Rows per page" });

    await userEvent.selectOptions(rowsPerPage, "10");
    await expect(within(recentSection).getByText("Showing 1 to 10 of 14 results")).toBeInTheDocument();
    await expect(within(recentSection).getAllByRole("row")).toHaveLength(11);
  },
};

/** Range presets replace the displayed recent-request window and values. */
export const RangePresetChangesTable = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const recentSection = canvas.getByRole("heading", { name: "Recent requests" }).closest("section");

    await expect(within(recentSection).getByText("Showing 1 to 14 of 14 results")).toBeInTheDocument();
    await expect(within(recentSection).getByText("128.4K", { exact: false })).toBeInTheDocument();

    const dateRange = canvas.getByRole("group", { name: "Date range" });
    await userEvent.click(within(dateRange).getByRole("button", { name: "1D" }));

    await expect(within(recentSection).getByText("Showing 1 to 2 of 2 results")).toBeInTheDocument();
    await expect(within(recentSection).queryByText("128.4K", { exact: false })).not.toBeInTheDocument();
  },
};

/** API key usage with Production expanded to show its per-model breakdown. */
export const ApiKeyExpanded = {
  args: {
    initialExpandedKey: "production",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByRole("button", { name: /Production/ });
    const detailId = toggle.getAttribute("aria-controls");

    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(canvasElement.querySelector(`#${detailId}`)).toBeInTheDocument();
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(canvasElement.querySelector(`#${detailId}`)).not.toBeInTheDocument();
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(canvasElement.querySelector(`#${detailId}`)).toBeInTheDocument();
  },
};

/** Recent requests pre-filtered to aborted Codex traffic with an updated result count. */
export const Filtered = {
  args: {
    initialProvider: "codex",
    initialStatus: "aborted",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const recentSection = canvas.getByRole("heading", { name: "Recent requests" }).closest("section");
    const recentTableBody = recentSection.querySelector("tbody");
    const recentTable = within(recentTableBody);

    await expect(within(recentSection).getByText("Showing 1 to 2 of 2 results")).toBeInTheDocument();
    await expect(recentTable.getByText("codex-mini-latest")).toBeInTheDocument();
    await expect(recentTable.getByText("gpt-5.6-sol")).toBeInTheDocument();
    await expect(recentTable.getAllByText("aborted")).toHaveLength(2);
  },
};

/** Custom range with a concrete from/to selection driving scaled analytics. */
export const CustomRange = {
  args: {
    initialRange: { preset: "custom", from: "2026-08-01", to: "2026-08-15" },
  },
};

import { expect, userEvent, within } from "storybook/test";

import { withDashboardShell } from "@/shared/ui/shell/withDashboardShell.jsx";

import TokenSaverStatsPage from "./TokenSaverStatsPage.jsx";

const meta = {
  title: "Durin DS/Pages/Token Saver Statistics",
  component: TokenSaverStatsPage,
  parameters: { layout: "fullscreen" },
  decorators: [
    withDashboardShell({
      activePath: "/dashboard/token-saver",
      title: "Token Saver",
      subtitle: "Compress prompts and outputs to save tokens",
      icon: "compress",
    }),
  ],
};

export default meta;

/** Consolidated 30-day overview with compression totals, PXPipe activity, history, and transform events. */
export const Statistics = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const historySection = canvas.getByRole("heading", { name: "History" }).closest("section");
    const historyBody = historySection.querySelector("tbody");
    const initialHistoryCount = within(historyBody).getAllByRole("row").length;
    const initialHistory = historyBody.textContent;
    const rowsSelect = within(historySection).getByRole("combobox", { name: "Rows per page" });

    await userEvent.selectOptions(rowsSelect, "10");
    await expect(rowsSelect).toHaveValue("10");
    await expect(within(historySection).getByText("Showing 1 to 6 of 6 results")).toBeInTheDocument();
    await expect(initialHistory).toContain("141.4K");
    await userEvent.click(canvas.getByRole("button", { name: "1D" }));
    await expect(within(historySection).getByText("Showing 1 to 1 of 1 results")).toBeInTheDocument();
    await expect(within(historyBody).getAllByRole("row")).toHaveLength(1);
    await expect(initialHistoryCount).toBe(6);
    await expect(historyBody).not.toHaveTextContent("64.8K");
    await expect(historyBody.textContent).not.toBe(initialHistory);
  },
};

/** Concrete custom date range to demonstrate the RangeSelector custom preset. */
export const CustomRange = {
  args: {
    initialRange: { preset: "custom", from: "2026-08-10", to: "2026-08-25" },
  },
};

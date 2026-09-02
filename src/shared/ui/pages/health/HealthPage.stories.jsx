import { expect, userEvent, within } from "storybook/test";

import HealthPage from "./HealthPage.jsx";
import { withDashboardShell } from "@/shared/ui/shell/withDashboardShell.jsx";

const meta = {
  title: "Durin DS/Pages/Health",
  component: HealthPage,
  decorators: [
    withDashboardShell({
      activePath: "/dashboard/health",
      title: "Provider Health",
      subtitle: "Reachability of your configured provider connections",
      icon: "health_and_safety",
    }),
  ],
  parameters: { layout: "fullscreen" },
};

export default meta;

export const AllConnections = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const rowsSelect = canvas.getByRole("combobox", { name: "Rows per page" });

    await userEvent.selectOptions(rowsSelect, "10");
    await expect(rowsSelect).toHaveValue("10");
    await expect(canvas.getByText("Showing 1 to 9 of 9 results")).toBeInTheDocument();
  },
};

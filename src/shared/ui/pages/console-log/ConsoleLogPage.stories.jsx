import { expect, within } from "storybook/test";

import ConsoleLogPage from "./ConsoleLogPage.jsx";

import { withDashboardShell } from "@/shared/ui/shell/withDashboardShell.jsx";

const meta = {
  title: "Durin DS/Pages/Console Log",
  component: ConsoleLogPage,
  parameters: { layout: "fullscreen" },
  decorators: [
    withDashboardShell({
      activePath: "/dashboard/console-log",
      icon: "terminal",
      title: "Console Log",
      subtitle: "Live server console output",
    }),
  ],
};

export default meta;

/** Full rolling buffer with interactive search, level chips, pause, and clear controls. */
export const Log = {
  args: { initialView: "log" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // `--log` is the manifest-mapped scenario. Switch its real Tabs control
    // to Timeline, which mounts all three internal timeline surfaces.
    await expect(canvas.getByRole("complementary", { name: "Dashboard navigation" })).toBeVisible();
    await expect(canvas.getByRole("log", { name: "Server console output" })).toBeVisible();
    await canvas.getByRole("tab", { name: "Timeline" }).click();
    await expect(canvas.getByRole("img", { name: /info.*warnings.*errors/i })).toBeVisible();
    await expect(canvas.getByText("Log volume")).toBeVisible();
    await expect(canvas.getByText("By level")).toBeVisible();
    await expect(canvas.getByText("Top sources")).toBeVisible();
  },
};

/** Sixty-minute volume, level distribution, and source activity overview. */
export const Timeline = {
  args: { initialView: "timeline" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // TimelineView renders LogVolumeChart, LevelBreakdown, and TopSources.
    // The level breakdown exposes its totals as an img accessible-name so
    // downstream readers can assert the rendered ratios without inspecting
    // inline progress-bar widths.
    await expect(canvas.getByRole("img", { name: /info.*warnings.*errors/i })).toBeVisible();
    await expect(canvas.getByText("Log volume")).toBeVisible();
    await expect(canvas.getByText("By level")).toBeVisible();
    await expect(canvas.getByText("Top sources")).toBeVisible();
  },
};

/** Frozen stream state with a resume action. */
export const Paused = {
  args: { initialView: "log", initialPaused: true },
};

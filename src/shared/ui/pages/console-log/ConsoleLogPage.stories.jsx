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
};

/** Sixty-minute volume, level distribution, and source activity overview. */
export const Timeline = {
  args: { initialView: "timeline" },
};

/** Frozen stream state with a resume action. */
export const Paused = {
  args: { initialView: "log", initialPaused: true },
};

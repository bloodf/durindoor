import React from "react";

globalThis.React ??= React;

import { withDashboardShell } from "@/shared/ui/shell/withDashboardShell.jsx";

import CliToolsPage from "./CliToolsPage.jsx";

const meta = {
  title: "Durin DS/Pages/CLI Tools",
  component: CliToolsPage,
  parameters: { layout: "fullscreen" },
  decorators: [
    withDashboardShell({
      activePath: "/dashboard/cli-tools",
      title: "CLI Tools",
      subtitle: "Configure CLI tools",
      icon: "code",
    }),
  ],
};

export default meta;

/** Responsive CLI and MITM integration catalog with configuration status badges. */
export const Default = {};

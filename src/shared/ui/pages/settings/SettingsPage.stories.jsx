import React from "react";

globalThis.React ??= React;

import { withDashboardShell } from "@/shared/ui/shell/withDashboardShell.jsx";

import SettingsPage from "./SettingsPage.jsx";

const meta = {
  title: "Durin DS/Pages/Settings",
  component: SettingsPage,
  parameters: { layout: "fullscreen" },
  decorators: [
    withDashboardShell({
      activePath: "/dashboard/profile",
      title: "Settings",
      subtitle: "Manage your preferences",
      icon: "settings",
    }),
  ],
};

export default meta;

/** Full local, authentication, routing, network, and observability settings page. */
export const Default = {};

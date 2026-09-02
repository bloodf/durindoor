import React from "react";
import { withDashboardShell } from "@/shared/ui/shell/withDashboardShell.jsx";

import SettingsPage from "./SettingsPage.jsx";

const meta = {
  title: "Durin DS/Pages/Token Saver Settings",
  component: SettingsPage,
  parameters: { layout: "fullscreen" },
  decorators: [
    withDashboardShell({
      activePath: "/dashboard/token-saver/settings",
      title: "Token Saver",
      subtitle: "Compress prompts and outputs to save tokens",
      icon: "compress",
    }),
  ],
};

export default meta;

/** All compression engines enabled with both configuration cards expanded. */
export const Default = {};

/** Mixed engine state for checking enabled, disabled, and level controls together. */
export const MixedState = {
  args: {
    initialRtk: false,
    initialHeadroom: true,
    initialCaveman: "lite",
    initialPonytail: "ultra",
  },
};

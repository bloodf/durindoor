import React from "react";

globalThis.React ??= React;

import Button from "@/shared/ui/components/Button.jsx";
import { withDashboardShell } from "@/shared/ui/shell/withDashboardShell.jsx";

import ProxyPoolsPage from "./ProxyPoolsPage.jsx";

const actions = (
  <>
    <Button variant="ghost" size="sm">
      Deploy Relay
    </Button>
    <Button variant="ghost" size="sm">
      Batch Import
    </Button>
    <Button variant="primary" size="sm" icon="add">
      Add Proxy Pool
    </Button>
  </>
);

const meta = {
  title: "Durin DS/Pages/Proxy Pools",
  component: ProxyPoolsPage,
  parameters: { layout: "fullscreen" },
  decorators: [
    withDashboardShell({
      activePath: "/dashboard/proxy-pools",
      title: "Proxy Pools",
      subtitle: "Manage your proxy pool configurations",
      icon: "router",
      actions,
    }),
  ],
};

export default meta;

/** Empty proxy-pool collection with both page-level and in-context creation actions. */
export const Empty = {};

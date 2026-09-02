import React from "react";

globalThis.React ??= React;

import Button from "@/shared/ui/components/Button.jsx";
import { withDashboardShell } from "@/shared/ui/shell/withDashboardShell.jsx";

import MediaProvidersPage from "./MediaProvidersPage.jsx";

const meta = {
  title: "Durin DS/Pages/Media Providers",
  component: MediaProvidersPage,
  parameters: { layout: "fullscreen" },
  decorators: [
    withDashboardShell({
      activePath: "/dashboard/media-providers/embedding",
      title: "Embedding",
      subtitle: "Manage your Embedding providers",
      icon: "deployed_code",
      actions: (
        <Button variant="primary" size="sm" icon="add">
          Add Custom Embedding
        </Button>
      ),
    }),
  ],
};

export default meta;

/** Responsive embedding-provider catalog with disconnected, connected, and disabled states. */
export const Default = {};

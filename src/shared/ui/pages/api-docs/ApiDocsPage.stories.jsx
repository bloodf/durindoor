import { withDashboardShell } from "@/shared/ui/shell/withDashboardShell.jsx";

import ApiDocsPage from "./ApiDocsPage.jsx";

const meta = {
  title: "Durin DS/Pages/API Docs",
  component: ApiDocsPage,
  decorators: [
    withDashboardShell({
      activePath: "/dashboard/api-docs",
      title: "API Documentation",
      subtitle: "OpenAI, Anthropic, media, and realtime endpoint reference",
      icon: "description",
    }),
  ],
  parameters: { layout: "fullscreen" },
};

export default meta;

export const Default = {};

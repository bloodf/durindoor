import { withDashboardShell } from "@/shared/ui/shell/withDashboardShell.jsx";

import McpHelpPage from "./McpHelpPage.jsx";

const meta = {
  title: "Durin DS/Pages/MCP Help",
  component: McpHelpPage,
  decorators: [
    withDashboardShell({
      activePath: "/dashboard/mcp-help",
      title: "MCP Help",
      subtitle: "Model Context Protocol gateway documentation",
      icon: "help",
    }),
  ],
  parameters: { layout: "fullscreen" },
};

export default meta;

export const Default = {};

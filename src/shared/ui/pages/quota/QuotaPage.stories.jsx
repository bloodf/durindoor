import { withDashboardShell } from "@/shared/ui/shell/withDashboardShell.jsx";

import QuotaPage from "./QuotaPage.jsx";
import { QUOTA_PROVIDERS } from "./mockData.js";

const meta = {
  title: "Durin DS/Pages/Quota Tracker",
  component: QuotaPage,
  parameters: { layout: "fullscreen" },
  decorators: [
    withDashboardShell({
      activePath: "/dashboard/quota",
      title: "Quota Tracker",
      subtitle: "Track and manage your API quota limits",
      icon: "data_usage",
    }),
  ],
};

export default meta;

export const Default = {
  render: () => <QuotaPage providers={QUOTA_PROVIDERS} />,
};

export const FilteredToCodex = {
  render: () => (
    <QuotaPage providers={QUOTA_PROVIDERS} defaultProviderFilter="codex" autoRefresh={false} />
  ),
};

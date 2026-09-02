import Button from "@/shared/ui/components/Button.jsx";
import { withDashboardShell } from "@/shared/ui/shell/withDashboardShell.jsx";

import ProvidersPage from "./ProvidersPage.jsx";

const actions = (
  <>
    <Button variant="primary" size="sm" icon="add">
      Add OpenAI Compatible
    </Button>
    <Button variant="secondary" size="sm">
      Add Anthropic Compatible
    </Button>
  </>
);

const meta = {
  title: "Durin DS/Pages/Providers",
  component: ProvidersPage,
  parameters: { layout: "fullscreen" },
  decorators: [
    withDashboardShell({
      activePath: "/dashboard/providers",
      title: "Providers",
      subtitle: "Manage your AI provider connections",
      icon: "dns",
      actions,
    }),
  ],
};

export default meta;

/** Active provider connections, custom-provider empty state, and both connection methods. */
export const Overview = {};

/** Full provider inventory, including disabled free-tier cards. */
export const FilterAll = {
  args: { initialStatus: "all" },
};

/** Deactivated filter isolates providers that are configured but currently disabled. */
export const Deactivated = {
  args: { initialStatus: "deactivated" },
};

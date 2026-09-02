import Button from "@/shared/ui/components/Button";

import DashboardShell from "./DashboardShell";
import Header from "./Header";
import Sidebar from "./Sidebar";

const meta = {
  title: "Durin DS/Shell",
  parameters: { layout: "fullscreen" },
};

export default meta;

function SidebarFrame({ children }) {
  return <div className="h-screen bg-dd-bg text-dd-text">{children}</div>;
}

export const SidebarDefault = {
  render: () => (
    <SidebarFrame>
      <Sidebar
        activePath="/dashboard/usage"
        onNavigate={() => undefined}
        onToggleCollapse={() => undefined}
      />
    </SidebarFrame>
  ),
};

export const SidebarProvidersActive = {
  render: () => (
    <SidebarFrame>
      <Sidebar
        activePath="/dashboard/providers"
        onNavigate={() => undefined}
        onToggleCollapse={() => undefined}
      />
    </SidebarFrame>
  ),
};

export const SidebarCollapsed = {
  render: () => (
    <SidebarFrame>
      <Sidebar
        activePath="/dashboard/combos"
        collapsed
        onNavigate={() => undefined}
        onToggleCollapse={() => undefined}
      />
    </SidebarFrame>
  ),
};

export const SidebarTokenSaverExpanded = {
  render: () => (
    <SidebarFrame>
      <Sidebar
        activePath="/dashboard/headroom"
        onNavigate={() => undefined}
        onToggleCollapse={() => undefined}
      />
    </SidebarFrame>
  ),
};

export const HeaderBare = {
  render: () => <Header />,
};

export const HeaderWithPageTitle = {
  render: () => (
    <Header
      icon="dns"
      title="Providers"
      subtitle="Manage upstream model connections"
    />
  ),
};

export const HeaderWithActions = {
  render: () => (
    <Header
      icon="layers"
      title="Combos"
      subtitle="Compose resilient provider routes"
      actions={
        <Button variant="primary" size="sm" icon="add">
          New combo
        </Button>
      }
    />
  ),
};

export const FullDashboardShell = {
  render: () => (
    <DashboardShell
      activePath="/dashboard/providers"
      defaultCollapsed={false}
      icon="dns"
      title="Providers"
      subtitle="Manage upstream model connections"
      actions={
        <Button variant="primary" size="sm" icon="add">
          Add provider
        </Button>
      }
      onNavigate={() => undefined}
    >
      <div className="grid gap-4 lg:grid-cols-3">
        {["Anthropic", "OpenAI", "Google"].map((provider) => (
          <section
            key={provider}
            className="rounded-dd-lg border border-dd-border bg-dd-surface p-5 shadow-dd-elevated"
          >
            <div className="mb-8 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-dd-text">{provider}</h2>
              <span className="text-xs text-dd-success">Healthy</span>
            </div>
            <p className="text-xs text-dd-muted">Provider connection placeholder</p>
          </section>
        ))}
      </div>
    </DashboardShell>
  ),
};

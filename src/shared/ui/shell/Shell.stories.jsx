import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
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

function InteractiveSidebar({ collapsed: initialCollapsed = false, activePath = "/dashboard/token-saver" }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [path, setPath] = useState(activePath);
  return (
    <SidebarFrame>
      <Sidebar
        activePath={path}
        collapsed={collapsed}
        onNavigate={setPath}
        onToggleCollapse={() => setCollapsed((value) => !value)}
      />
    </SidebarFrame>
  );
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
      <p className="mt-2 px-3 text-xs text-dd-muted">Collapsed navigation</p>
    </SidebarFrame>
  ),
};

export const SidebarTokenSaverExpanded = {
  render: () => (
    <SidebarFrame>
      <Sidebar
        activePath="/dashboard/token-saver"
        onNavigate={() => undefined}
        onToggleCollapse={() => undefined}
      />
    </SidebarFrame>
  ),
};

export const SidebarInteractions = {
  render: () => <InteractiveSidebar />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const tokenSaver = canvas.getByRole("button", { name: "Token Saver" });
    await userEvent.click(tokenSaver);
    await expect(tokenSaver).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(tokenSaver);
    await expect(canvas.getByRole("link", { name: "Statistics" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Collapse sidebar" }));
    await expect(canvas.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  },
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

export const HeaderThemeToggle = {
  render: () => <Header title="Providers" subtitle="Manage upstream model connections" icon="dns" />,
  play: async ({ canvasElement }) => {
    const toggle = within(canvasElement).getByRole("button", { name: "Toggle theme" });
    await userEvent.click(toggle);
    await expect(document.documentElement).toHaveClass("dark");
    await userEvent.click(toggle);
    await expect(document.documentElement).not.toHaveClass("dark");
  },
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

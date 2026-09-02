import { useState } from "react";

import Header from "./Header";
import Sidebar from "./Sidebar";

/** Full-viewport shell shared by dashboard pages and Storybook page mocks. */
export function DashboardShell({
  activePath = "",
  title,
  subtitle,
  icon,
  actions,
  children,
  defaultCollapsed = false,
  onNavigate,
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div className="flex h-screen overflow-hidden bg-dd-bg text-dd-text">
      <Sidebar
        activePath={activePath}
        collapsed={collapsed}
        onNavigate={onNavigate}
        onToggleCollapse={() => setCollapsed((value) => !value)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header title={title} subtitle={subtitle} icon={icon} actions={actions} />
        <main className="min-h-0 flex-1 overflow-y-auto p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}

export default DashboardShell;

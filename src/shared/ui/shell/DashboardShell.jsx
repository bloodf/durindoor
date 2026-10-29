import { useEffect, useState } from "react";

import Header from "./Header";
import Sidebar from "./Sidebar";
import Drawer from "@/shared/ui/components/Drawer";

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
  const [navigationOpen, setNavigationOpen] = useState(false);

  useEffect(() => {
    const media = globalThis.matchMedia?.("(min-width: 1024px)");
    if (!media) return undefined;
    const closeOnDesktop = () => { if (media.matches) setNavigationOpen(false); };
    closeOnDesktop();
    media.addEventListener("change", closeOnDesktop);
    return () => media.removeEventListener("change", closeOnDesktop);
  }, []);

  return (
    <div className="flex h-screen w-full bg-dd-bg text-dd-text">
      <div className="hidden shrink-0 lg:flex">
        <Sidebar
          activePath={activePath}
          collapsed={collapsed}
          onNavigate={onNavigate}
          onToggleCollapse={() => setCollapsed((value) => !value)}
        />
      </div>
      <Drawer
        open={navigationOpen}
        onClose={() => setNavigationOpen(false)}
        title="Navigation"
        width={320}
        className="lg:hidden"
      >
        <div className="h-full min-h-0 [&>aside]:h-full [&>aside]:min-h-0 [&>aside]:w-full">
          <Sidebar
            activePath={activePath}
            onNavigate={onNavigate}
            onClose={() => setNavigationOpen(false)}
          />
        </div>
      </Drawer>
      <div className="flex min-w-0 flex-1 flex-col">
        <Header title={title} subtitle={subtitle} icon={icon} actions={actions} onMenuClick={() => setNavigationOpen(true)} />
        <main tabIndex={0} aria-label="Dashboard content" className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 xl:p-8">
          {/* Match production: 16/24/32px gutters around a full-width 7xl content area. */}
          <div className="mx-auto w-full min-w-0 max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

export default DashboardShell;

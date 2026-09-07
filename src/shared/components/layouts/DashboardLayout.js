"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useNotificationStore } from "@/store/notificationStore";
import Sidebar from "../Sidebar";
import Header from "../Header";
import Drawer from "@/shared/ui/components/Drawer.jsx";
import { isUndefined } from "@/shared/utils/typeChecks";

const SIDEBAR_COLLAPSED_KEY = "durindoor.sidebar.collapsed";

function getToastStyle(type) {
  if (type === "success") {
    return {
      wrapper: "border-dd-success bg-dd-success/10 text-dd-success",
      icon: "check_circle",
    };
  }
  if (type === "error") {
    return {
      wrapper: "border-dd-danger bg-dd-danger/10 text-dd-danger",
      icon: "error",
    };
  }
  if (type === "warning") {
    return {
      wrapper: "border-dd-warning bg-dd-warning/10 text-dd-warning",
      icon: "warning",
    };
  }
  return {
    wrapper: "border-dd-info bg-dd-info/10 text-dd-info",
    icon: "info",
  };
}

export default function DashboardLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const pathname = usePathname();
  const notifications = useNotificationStore((state) => state.notifications);
  const removeNotification = useNotificationStore((state) => state.removeNotification);

  useEffect(() => {
    if (isUndefined(globalThis) || isUndefined(globalThis.localStorage)) return undefined;
    try {
      if (globalThis.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1") setSidebarCollapsed(true);
    } catch {}
    return undefined;
  }, []);
  useEffect(() => {
    const media = globalThis.matchMedia?.("(min-width: 1024px)");
    if (!media) return undefined;
    const closeOnDesktop = () => { if (media.matches) setSidebarOpen(false); };
    closeOnDesktop();
    media.addEventListener("change", closeOnDesktop);
    return () => media.removeEventListener("change", closeOnDesktop);
  }, []);

  const toggleSidebarCollapse = () => {
    setSidebarCollapsed((current) => {
      const next = !current;
      try {
        globalThis.localStorage?.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-dd-bg">
      <div className="fixed end-4 top-4 z-[80] flex w-[min(92vw,380px)] flex-col gap-2">
        {notifications.map((n) => {
          const style = getToastStyle(n.type);
          return (
            <div
              key={n.id}
              className={`rounded-dd border px-3 py-2 shadow-dd-elevated backdrop-blur-sm ${style.wrapper}`}
            >
              <div className="flex items-start gap-2">
                <span aria-hidden="true" className="material-symbols-outlined text-[18px] leading-5">{style.icon}</span>
                <div className="min-w-0 flex-1">
                  {n.title ? <p className="mb-0.5 text-xs font-semibold">{n.title}</p> : null}
                  <p className="text-xs whitespace-pre-wrap break-words">{n.message}</p>
                </div>
                {n.dismissible ? (
                  <button
                    type="button"
                    onClick={() => removeNotification(n.id)}
                    className="-me-2 -mt-2 flex min-h-11 min-w-11 items-center justify-center rounded-dd text-dd-muted outline-none transition-colors hover:text-dd-text focus-visible:shadow-dd-focus"
                    aria-label="Dismiss notification"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[16px]">close</span>
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <div className="hidden shrink-0 lg:flex">
        <Sidebar collapsed={sidebarCollapsed} onToggleCollapse={toggleSidebarCollapse} />
      </div>



      <Drawer
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        title="Navigation"
        width={320}
        className="lg:hidden"
      >
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </Drawer>
      <main className="flex flex-col flex-1 h-full min-w-0 relative transition-colors duration-300 isolate">
        <Header key={pathname} onMenuClick={() => setSidebarOpen(true)} />
        <div tabIndex={0} role="region" aria-label="Page content" className={`flex-1 overflow-y-auto custom-scrollbar outline-none focus-visible:shadow-dd-focus ${pathname === "/dashboard/playground" ? "" : "p-6 lg:p-10"} ${pathname === "/dashboard/playground" ? "flex flex-col overflow-hidden" : ""}`}>
          <div className={`${pathname === "/dashboard/playground" ? "flex-1 w-full h-full flex flex-col" : "max-w-7xl mx-auto"}`}>{children}</div>
        </div>
      </main>
    </div>
  );
}

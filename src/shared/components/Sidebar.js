"use client";

import { useEffect, useId, useState } from "react";
import PropTypes from "prop-types";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/shared/utils/cn";
import { APP_CONFIG, UPDATER_CONFIG } from "@/shared/constants/config";
import { MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";
import UpdatePanel from "./UpdatePanel";
import Modal from "@/shared/ui/components/Modal.jsx";
import Tooltip from "@/shared/ui/components/Tooltip.jsx";
import {
  BRAND_LOGO_ALT,
  BRAND_LOGO_SRC,
  COMBINED_WEB_ITEM,
  isActivePath,
  NavIcon,
  NAV_SECTIONS,
  PROFILE_NAV_ITEM,
  VISIBLE_MEDIA_KINDS,
} from "./SidebarNavIcons";

function SidebarTooltip({ collapsed, label, children }) {
  return collapsed ? <Tooltip content={label} side="right">{children}</Tooltip> : children;
}

SidebarTooltip.propTypes = {
  collapsed: PropTypes.bool,
  label: PropTypes.string.isRequired,
  children: PropTypes.element.isRequired,
};

// Shared link chrome for a leaf nav row. Accent marks the active route only;
// every other row stays on muted neutral until hover.
function itemClasses(collapsed, active, indent = false) {
  return cn(
    collapsed
      ? "flex min-h-11 w-full items-center justify-center rounded-dd px-0 py-1 outline-none transition-all focus-visible:shadow-dd-focus group"
      : indent
        ? "flex min-h-11 items-center gap-3 px-4 py-1 rounded-dd outline-none transition-all focus-visible:shadow-dd-focus group"
        : "flex min-h-11 items-center gap-3 px-3 py-1 rounded-dd outline-none transition-all focus-visible:shadow-dd-focus group",
    active ? "bg-dd-accent-soft text-dd-accent" : "text-dd-muted hover:bg-dd-surface-2 hover:text-dd-text"
  );
}

export default function Sidebar({ onClose, collapsed: collapsedProp, onToggleCollapse }) {
  const pathname = usePathname();
  const groupIdBase = useId();
  const collapsed = collapsedProp ?? false;
  const handleToggleCollapse = onToggleCollapse ?? (() => undefined);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [enableTranslator, setEnableTranslator] = useState(false);
  // Collapsible group overrides, keyed by group entry key. An absent key falls
  // back to "open when the current route is inside the group".
  const [groupOverrides, setGroupOverrides] = useState({});

  const INSTALL_CMD = UPDATER_CONFIG.installCmdLatest;

  const isActive = (href, exact = false) => isActivePath(pathname, href, exact);

  const groupActive = (children) =>
    children.some((child) => isActivePath(pathname, child.href, child.exact !== false));
  const isGroupOpen = (key, active) => groupOverrides[key] ?? active;
  const toggleGroup = (key, active) =>
    setGroupOverrides((prev) => ({ ...prev, [key]: !(prev[key] ?? active) }));

  useEffect(() => {
    fetch("/api/settings")
      .then(res => res.json())
      .then(data => { if (data.enableTranslator) setEnableTranslator(true); })
      .catch(() => {});
  }, []);

  // Lazy check for new npm version on mount
  useEffect(() => {
    fetch("/api/version")
      .then(res => res.json())
      .then(data => { if (data.hasUpdate) setUpdateInfo(data); })
      .catch(() => {});
  }, []);

  const renderItem = (item, indent = false) => {
    if (item.requiresTranslator && !enableTranslator) return null;
    const active = isActive(item.href, item.exact !== false);
    return (
      <SidebarTooltip key={item.href} collapsed={collapsed} label={item.label}>
        <Link
          href={item.href}
          onClick={onClose}
          aria-label={collapsed ? item.label : undefined}
          aria-current={active ? "page" : undefined}
          className={itemClasses(collapsed, active, indent)}
        >
          <NavIcon icon={item.icon} isActive={active} size={indent ? "16" : "18"} />
          <span className={indent ? "text-sm" : "sidebar-label text-[13px] font-medium"}>{item.label}</span>
        </Link>
      </SidebarTooltip>
    );
  };

  const renderGroup = (group) => {
    const groupId = `${groupIdBase}-${group.key}`;
    const active = groupActive(group.children);
    const open = isGroupOpen(group.key, active);
    return (
      <div key={group.key}>
        <SidebarTooltip collapsed={collapsed} label={group.label}>
          {collapsed ? (
            <Link
              href={group.children[0].href}
              onClick={onClose}
              aria-label={group.label}
              className={itemClasses(true, active)}
            >
              <NavIcon icon={group.icon} isActive={active} />
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => toggleGroup(group.key, active)}
              aria-expanded={open}
              aria-controls={groupId}
              className={cn("w-full", itemClasses(false, active))}
            >
              <NavIcon icon={group.icon} isActive={active} />
              <span className="sidebar-label text-[13px] font-medium flex-1 text-left">{group.label}</span>
              <span aria-hidden="true" className="sidebar-label material-symbols-outlined text-[14px] transition-transform" style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}>expand_more</span>
            </button>
          )}
        </SidebarTooltip>
        {!collapsed && open && (
          <div id={groupId} className="pl-4">
            {group.children.map((child) => renderItem({ type: "item", ...child }, true))}
          </div>
        )}
      </div>
    );
  };

  // Media Providers accordion: children are the visible media kinds plus the
  // combined Web Fetch & Search page, resolved from provider constants.
  const renderMediaGroup = (entry) => {
    const groupId = `${groupIdBase}-${entry.key}`;
    const mediaChildren = [
      ...MEDIA_PROVIDER_KINDS.filter((k) => VISIBLE_MEDIA_KINDS.includes(k.id)).map((kind) => ({
        href: `${entry.basePath}/${kind.id}`,
        label: kind.label,
        icon: kind.icon,
      })),
      { href: COMBINED_WEB_ITEM.href, label: COMBINED_WEB_ITEM.label, icon: COMBINED_WEB_ITEM.icon },
    ];
    const active = pathname?.startsWith(entry.basePath) || false;
    const open = isGroupOpen(entry.key, active);
    return (
      <div key={entry.key}>
        <SidebarTooltip collapsed={collapsed} label={entry.label}>
          {collapsed ? (
            <Link href={mediaChildren[0].href} onClick={onClose} aria-label={entry.label} className={itemClasses(true, active)}>
              <NavIcon icon={entry.icon} isActive={active} />
            </Link>
          ) : (
            <button type="button" onClick={() => toggleGroup(entry.key, active)} aria-expanded={open} aria-controls={groupId} className={cn("w-full", itemClasses(false, active))}>
              <NavIcon icon={entry.icon} isActive={active} />
              <span className="sidebar-label text-[13px] font-medium flex-1 text-left">{entry.label}</span>
              <span aria-hidden="true" className="sidebar-label material-symbols-outlined text-[14px] transition-transform" style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}>expand_more</span>
            </button>
          )}
        </SidebarTooltip>
        {!collapsed && open && (
          <div id={groupId} className="pl-4">
            {mediaChildren.map((child) => {
              const childActive = pathname?.startsWith(child.href) || false;
              return (
                <Link
                  key={child.href}
                  href={child.href}
                  onClick={onClose}
                  aria-current={childActive ? "page" : undefined}
                  className={itemClasses(false, childActive, true)}
                >
                  <NavIcon icon={child.icon} isActive={childActive} size="16" />
                  <span className="text-sm">{child.label}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <aside className={cn("flex min-h-full flex-col overflow-hidden border-e border-dd-border-subtle bg-dd-surface transition-[width,colors] duration-300 motion-reduce:transition-none", collapsed ? "w-20" : "w-72", collapsed && "[&_.sidebar-label]:hidden [&_.sidebar-brand-copy]:hidden [&_.sidebar-section]:hidden [&_.sidebar-update]:hidden [&_.sidebar-section-divider]:block")} aria-label="Dashboard navigation">
        <div className={cn("flex flex-col gap-2 py-4", collapsed ? "items-center px-2" : "px-6")}>
          <Link href="/dashboard" aria-label={collapsed ? APP_CONFIG.name : undefined} className="flex min-h-11 min-w-11 items-center gap-3 rounded-dd outline-none focus-visible:shadow-dd-focus">
            <div className="flex size-9 items-center justify-center rounded-dd bg-dd-surface-3 shadow-dd-elevated">
              <img
                src={BRAND_LOGO_SRC}
                alt={BRAND_LOGO_ALT}
                width={36}
                height={36}
                className="object-contain"
              />
            </div>
            <div className="sidebar-brand-copy flex flex-col">
              <span className="text-lg font-semibold tracking-tight text-dd-text">
                {APP_CONFIG.name}
              </span>
              <span className="text-xs text-dd-muted">v{APP_CONFIG.version}</span>
            </div>
          </Link>
          {updateInfo && (
            <div className="sidebar-update flex flex-col gap-1.5 rounded p-1 -m-1">
              <span className="text-xs font-semibold text-dd-success">
                ↑ New version available: v{updateInfo.latestVersion}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsUpdating(true)}
                  className="min-h-11 min-w-11 px-2 py-1 rounded-dd bg-dd-accent hover:bg-dd-accent-hover text-dd-on-accent text-[11px] font-semibold outline-none focus-visible:shadow-dd-focus transition-colors cursor-pointer"
                >
                  Update now
                </button>
                <code className="flex-1 text-[10px] text-dd-muted font-mono truncate" title={INSTALL_CMD}>
                  {INSTALL_CMD}
                </code>
              </div>
            </div>
          )}
        </div>

        {/* Navigation: labeled IA sections from NAV_SECTIONS */}
        <nav className={cn("flex flex-1 flex-col gap-0.5 py-2 overflow-y-auto custom-scrollbar", collapsed ? "px-2" : "px-4")}>
          {NAV_SECTIONS.map((section, sectionIndex) => (
            <div key={section.key} role="group" aria-label={section.label} className={cn("flex flex-col gap-0.5", sectionIndex > 0 && "pt-2 mt-1")}>
              {/* Hairline divider visible only when the rail is collapsed and
                  section labels are hidden. */}
              {sectionIndex > 0 && <div aria-hidden="true" className="sidebar-section-divider mx-2 mb-2 hidden border-t border-dd-border-subtle" />}
              <p className="sidebar-section px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-dd-subtle">
                {section.label}
              </p>
              {section.entries.map((entry) => {
                if (entry.type === "group") return renderGroup(entry);
                if (entry.type === "media") return renderMediaGroup(entry);
                return renderItem(entry);
              })}
            </div>
          ))}
        </nav>

        {/* Settings (profile) pinned at the bottom of the rail */}
        <div className={cn("shrink-0 border-t border-dd-border-subtle", collapsed ? "p-2" : "px-4 py-2")}>
          <SidebarTooltip collapsed={collapsed} label={PROFILE_NAV_ITEM.label}>
            <Link
              href={PROFILE_NAV_ITEM.href}
              onClick={onClose}
              aria-label={collapsed ? PROFILE_NAV_ITEM.label : undefined}
              aria-current={isActive(PROFILE_NAV_ITEM.href, true) ? "page" : undefined}
              className={itemClasses(collapsed, isActive(PROFILE_NAV_ITEM.href, true))}
            >
              <NavIcon icon={PROFILE_NAV_ITEM.icon} isActive={isActive(PROFILE_NAV_ITEM.href, true)} />
              <span className="sidebar-label text-[13px] font-medium">{PROFILE_NAV_ITEM.label}</span>
            </Link>
          </SidebarTooltip>
        </div>

        {onToggleCollapse ? (
          <div className="shrink-0 border-t border-dd-border-subtle p-2">
            <SidebarTooltip collapsed={collapsed} label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
              <button
                type="button"
                onClick={handleToggleCollapse}
                aria-pressed={collapsed}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                className={cn("flex min-h-11 w-full items-center gap-2 rounded-dd px-3 text-[13px] text-dd-muted outline-none transition-colors hover:bg-dd-surface-2 hover:text-dd-text focus-visible:shadow-dd-focus", collapsed && "justify-center px-0")}
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">{collapsed ? "chevron_right" : "chevron_left"}</span>
                <span className="sidebar-label">{collapsed ? "" : "Collapse"}</span>
              </button>
            </SidebarTooltip>
          </div>
        ) : null}
      </aside>

      <Modal
        open={isUpdating}
        onClose={() => setIsUpdating(false)}
        title="Update available"
        size="lg"
        className="z-[90]"
        showClose={false}
        closeOnEscape={false}
        closeOnOverlay={false}
      >
        <UpdatePanel
          currentVersion={updateInfo?.currentVersion || APP_CONFIG.version}
          latestVersion={updateInfo?.latestVersion}
          installCmd={INSTALL_CMD}
          onClose={() => setIsUpdating(false)}
        />
      </Modal>

    </>
  );
}

Sidebar.propTypes = {
  onClose: PropTypes.func,
  collapsed: PropTypes.bool,
  onToggleCollapse: PropTypes.func,
};

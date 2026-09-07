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
  debugItems,
  isActivePath,
  NavIcon,
  navItems,
  PROFILE_NAV_ITEM,
  providersMenu,
  systemItems,
  tokenSaverMenu,
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

export default function Sidebar({ onClose, collapsed: collapsedProp, onToggleCollapse }) {
  const pathname = usePathname();
  const providersGroupId = useId();
  const tokenSaverGroupId = useId();
  const mediaGroupId = useId();
  const [mediaOpen, setMediaOpen] = useState(false);
  const collapsed = collapsedProp ?? false;
  const handleToggleCollapse = onToggleCollapse ?? (() => undefined);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [enableTranslator, setEnableTranslator] = useState(false);

  const INSTALL_CMD = UPDATER_CONFIG.installCmdLatest;

  const isActive = (href, exact = false) => isActivePath(pathname, href, exact);

  const isTokenSaverSectionActive = tokenSaverMenu.children.some((child) =>
    isActivePath(pathname, child.href, true)
  );
  const [userToggled, setUserToggled] = useState(null);
  const [providersToggled, setProvidersToggled] = useState(null);
  const tokenSaverOpen = userToggled ?? isTokenSaverSectionActive;
  const isProvidersSectionActive = providersMenu.children.some((child) =>
    isActivePath(pathname, child.href, child.exact !== false),
  );
  const providersMenuOpen = providersToggled ?? isProvidersSectionActive;

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

  return (
    <>
      <aside className={cn("flex min-h-full flex-col overflow-hidden border-e border-dd-border-subtle bg-dd-surface transition-[width,colors] duration-300 motion-reduce:transition-none", collapsed ? "w-20" : "w-72", collapsed && "[&_.sidebar-label]:hidden [&_.sidebar-brand-copy]:hidden [&_.sidebar-section]:hidden [&_.sidebar-update]:hidden")} aria-label="Dashboard navigation">
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

        {/* Navigation */}
        <nav className={cn("flex flex-1 flex-col gap-0.5 py-2 overflow-y-auto custom-scrollbar", collapsed ? "px-2" : "px-4")}>
          {navItems.map((item) => (
            <SidebarTooltip key={item.href} collapsed={collapsed} label={item.label}>
              <Link
                href={item.href}
                onClick={onClose}
                aria-label={collapsed ? item.label : undefined}
                aria-current={isActive(item.href, item.exact !== false) ? "page" : undefined}
                className={cn(
                  collapsed ? "flex min-h-11 w-full items-center justify-center rounded-dd px-0 py-1 outline-none transition-all focus-visible:shadow-dd-focus group" : "flex min-h-11 items-center gap-3 px-3 py-1 rounded-dd outline-none transition-all focus-visible:shadow-dd-focus group",
                  isActive(item.href, item.exact !== false)
                    ? "bg-dd-accent-soft text-dd-accent"
                    : "text-dd-muted hover:bg-dd-surface-2 hover:text-dd-text"
                )}
              >
                <NavIcon icon={item.icon} isActive={isActive(item.href, item.exact !== false)} />
                <span className="sidebar-label text-[13px] font-medium">{item.label}</span>
              </Link>
            </SidebarTooltip>
          ))}

          {/* Providers collapsible menu */}
          <SidebarTooltip collapsed={collapsed} label={providersMenu.label}>
            {collapsed ? (
              <Link
                href={providersMenu.children[0].href}
                onClick={onClose}
                aria-label={providersMenu.label}
                className={cn("flex min-h-11 w-full items-center justify-center rounded-dd px-0 py-1 outline-none transition-all focus-visible:shadow-dd-focus group", isProvidersSectionActive ? "bg-dd-accent-soft text-dd-accent" : "text-dd-muted hover:bg-dd-surface-2 hover:text-dd-text")}
              >
                <NavIcon icon={providersMenu.icon} isActive={isProvidersSectionActive} />
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => setProvidersToggled((open) => !(open ?? isProvidersSectionActive))}
                aria-expanded={providersMenuOpen}
                aria-controls={providersGroupId}
                className={cn("w-full flex min-h-11 items-center gap-3 px-3 py-1 rounded-dd outline-none transition-all focus-visible:shadow-dd-focus group", isProvidersSectionActive ? "bg-dd-accent-soft text-dd-accent" : "text-dd-muted hover:bg-dd-surface-2 hover:text-dd-text")}
              >
                <NavIcon icon={providersMenu.icon} isActive={isProvidersSectionActive} />
                <span className="sidebar-label text-[13px] font-medium flex-1 text-left">{providersMenu.label}</span>
                <span aria-hidden="true" className="sidebar-label material-symbols-outlined text-[14px] transition-transform" style={{ transform: providersMenuOpen ? "rotate(180deg)" : "rotate(0deg)" }}>expand_more</span>
              </button>
            )}
          </SidebarTooltip>
          {!collapsed && providersMenuOpen && (
            <div id={providersGroupId} className="pl-4">
              {providersMenu.children.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  aria-current={isActive(item.href, item.exact !== false) ? "page" : undefined}
                  className={cn(
                    collapsed ? "flex min-h-11 items-center justify-center rounded-dd px-0 py-1 outline-none transition-all focus-visible:shadow-dd-focus group" : "flex min-h-11 items-center gap-3 px-4 py-1 rounded-dd outline-none transition-all focus-visible:shadow-dd-focus group",
                    isActive(item.href, item.exact !== false)
                      ? "bg-dd-accent-soft text-dd-accent"
                      : "text-dd-muted hover:bg-dd-surface-2 hover:text-dd-text"
                  )}
                >
                  <NavIcon icon={item.icon} isActive={isActive(item.href, item.exact !== false)} size="16" />
                  <span className="text-sm">{item.label}</span>
                </Link>
              ))}
            </div>
          )}

          <SidebarTooltip collapsed={collapsed} label={tokenSaverMenu.label}>
            {collapsed ? (
              <Link href={tokenSaverMenu.children[0].href} onClick={onClose} aria-label={tokenSaverMenu.label} className={cn("flex min-h-11 w-full items-center justify-center rounded-dd px-0 py-1 outline-none transition-all focus-visible:shadow-dd-focus group", isTokenSaverSectionActive ? "bg-dd-accent-soft text-dd-accent" : "text-dd-muted hover:bg-dd-surface-2 hover:text-dd-text")}>
                <NavIcon icon={tokenSaverMenu.icon} isActive={isTokenSaverSectionActive} />
              </Link>
            ) : (
              <button type="button" onClick={() => setUserToggled((open) => !(open ?? isTokenSaverSectionActive))} aria-expanded={tokenSaverOpen} aria-controls={tokenSaverGroupId} className={cn("w-full flex min-h-11 items-center gap-3 px-3 py-1 rounded-dd outline-none transition-all focus-visible:shadow-dd-focus group", isTokenSaverSectionActive ? "bg-dd-accent-soft text-dd-accent" : "text-dd-muted hover:bg-dd-surface-2 hover:text-dd-text")}>
                <NavIcon icon={tokenSaverMenu.icon} isActive={isTokenSaverSectionActive} />
                <span className="sidebar-label text-[13px] font-medium flex-1 text-left">{tokenSaverMenu.label}</span>
                <span aria-hidden="true" className="sidebar-label material-symbols-outlined text-[14px] transition-transform" style={{ transform: tokenSaverOpen ? "rotate(180deg)" : "rotate(0deg)" }}>expand_more</span>
              </button>
            )}
          </SidebarTooltip>
          {!collapsed && tokenSaverOpen && (
            <div id={tokenSaverGroupId} className="pl-4">
              {tokenSaverMenu.children.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  aria-current={isActive(item.href, item.exact !== false) ? "page" : undefined}
                  className={cn(
                    collapsed ? "flex min-h-11 items-center justify-center rounded-dd px-0 py-1 outline-none transition-all focus-visible:shadow-dd-focus group" : "flex min-h-11 items-center gap-3 px-4 py-1 rounded-dd outline-none transition-all focus-visible:shadow-dd-focus group",
                    isActive(item.href, item.exact !== false)
                      ? "bg-dd-accent-soft text-dd-accent"
                      : "text-dd-muted hover:bg-dd-surface-2 hover:text-dd-text"
                  )}
                >
                  <NavIcon icon={item.icon} isActive={isActive(item.href, item.exact !== false)} size="16" />
                  <span className="text-sm">{item.label}</span>
                </Link>
              ))}
            </div>
          )}

          {/* System section */}
          <div className="flex flex-col gap-0.5 pt-3 mt-2">
            <p className="sidebar-label px-4 text-xs font-semibold text-dd-muted uppercase tracking-wider mb-2">
              System
            </p>

            {/* Media Providers accordion */}
          <SidebarTooltip collapsed={collapsed} label="Media Providers">
            {collapsed ? (
              <Link href={`/dashboard/media-providers/${VISIBLE_MEDIA_KINDS[0]}`} onClick={onClose} aria-label="Media Providers" className={cn("flex min-h-11 w-full items-center justify-center rounded-dd px-0 py-1 outline-none transition-all focus-visible:shadow-dd-focus group", pathname?.startsWith("/dashboard/media-providers") ? "bg-dd-accent-soft text-dd-accent" : "text-dd-muted hover:bg-dd-surface-2 hover:text-dd-text")}>
                <NavIcon icon="perm_media" isActive={pathname?.startsWith("/dashboard/media-providers") || false} />
              </Link>
            ) : (
              <button type="button" onClick={() => setMediaOpen((v) => !v)} aria-expanded={mediaOpen} aria-controls={mediaGroupId} className={cn("w-full flex min-h-11 items-center gap-3 px-3 py-1 rounded-dd outline-none transition-all focus-visible:shadow-dd-focus group", pathname?.startsWith("/dashboard/media-providers") ? "bg-dd-accent-soft text-dd-accent" : "text-dd-muted hover:bg-dd-surface-2 hover:text-dd-text")}>
                <NavIcon icon="perm_media" isActive={pathname?.startsWith("/dashboard/media-providers") || false} />
                <span className="sidebar-label text-[13px] font-medium flex-1 text-left">Media Providers</span>
                <span aria-hidden="true" className="sidebar-label material-symbols-outlined text-[14px] transition-transform" style={{ transform: mediaOpen ? "rotate(180deg)" : "rotate(0deg)" }}>expand_more</span>
              </button>
            )}
          </SidebarTooltip>
            {!collapsed && mediaOpen && (
              <div id={mediaGroupId} className="pl-4">
                {MEDIA_PROVIDER_KINDS.filter((k) => VISIBLE_MEDIA_KINDS.includes(k.id)).map((kind) => (
                  <Link
                    key={kind.id}
                    href={`/dashboard/media-providers/${kind.id}`}
                    onClick={onClose}
                    aria-current={pathname?.startsWith(`/dashboard/media-providers/${kind.id}`) ? "page" : undefined}
                    className={cn(
                      collapsed ? "flex min-h-11 items-center justify-center rounded-dd px-0 py-1 outline-none transition-all focus-visible:shadow-dd-focus group" : "flex min-h-11 items-center gap-3 px-4 py-1 rounded-dd outline-none transition-all focus-visible:shadow-dd-focus group",
                      pathname?.startsWith(`/dashboard/media-providers/${kind.id}`)
                        ? "bg-dd-accent-soft text-dd-accent"
                        : "text-dd-muted hover:bg-dd-surface-2 hover:text-dd-text"
                    )}
                  >
                    <NavIcon icon={kind.icon} isActive={pathname?.startsWith(`/dashboard/media-providers/${kind.id}`) || false} size="16" />
                    <span className="text-sm">{kind.label}</span>
                  </Link>
                ))}
                <Link
                  key={COMBINED_WEB_ITEM.id}
                  href={COMBINED_WEB_ITEM.href}
                  onClick={onClose}
                  aria-current={pathname?.startsWith(COMBINED_WEB_ITEM.href) ? "page" : undefined}
                  className={cn(
                    collapsed ? "flex min-h-11 items-center justify-center rounded-dd px-0 py-1 outline-none transition-all focus-visible:shadow-dd-focus group" : "flex min-h-11 items-center gap-3 px-4 py-1 rounded-dd outline-none transition-all focus-visible:shadow-dd-focus group",
                    pathname?.startsWith(COMBINED_WEB_ITEM.href)
                      ? "bg-dd-accent-soft text-dd-accent"
                      : "text-dd-muted hover:bg-dd-surface-2 hover:text-dd-text"
                  )}
                >
                  <NavIcon icon={COMBINED_WEB_ITEM.icon} isActive={pathname?.startsWith(COMBINED_WEB_ITEM.href) || false} size="16" />
                  <span className="text-sm">{COMBINED_WEB_ITEM.label}</span>
                </Link>
              </div>
            )}

            {systemItems.map((item) => (
              <SidebarTooltip key={item.href} collapsed={collapsed} label={item.label}>
                <Link
                  href={item.href}
                  onClick={onClose}
                  aria-label={collapsed ? item.label : undefined}
                  aria-current={isActive(item.href, item.exact !== false) ? "page" : undefined}
                  className={cn(
                    collapsed ? "flex min-h-11 w-full items-center justify-center rounded-dd px-0 py-1 outline-none transition-all focus-visible:shadow-dd-focus group" : "flex min-h-11 items-center gap-3 px-3 py-1 rounded-dd outline-none transition-all focus-visible:shadow-dd-focus group",
                    isActive(item.href, item.exact !== false) ? "bg-dd-accent-soft text-dd-accent" : "text-dd-muted hover:bg-dd-surface-2 hover:text-dd-text"
                  )}
                >
                  <NavIcon icon={item.icon} isActive={isActive(item.href, item.exact !== false)} />
                  <span className="sidebar-label text-[13px] font-medium">{item.label}</span>
                </Link>
              </SidebarTooltip>
            ))}

            {/* Debug items (inside System section, before Settings) */}
            {debugItems.map((item) => {
              const show = item.href !== "/dashboard/translator" || enableTranslator;
              return show ? (
                <SidebarTooltip key={item.href} collapsed={collapsed} label={item.label}>
                  <Link
                    href={item.href}
                    onClick={onClose}
                    aria-label={collapsed ? item.label : undefined}
                    aria-current={isActive(item.href, true) ? "page" : undefined}
                    className={cn(
                      collapsed ? "flex min-h-11 w-full items-center justify-center rounded-dd px-0 py-1 outline-none transition-all focus-visible:shadow-dd-focus group" : "flex min-h-11 items-center gap-3 px-3 py-1 rounded-dd outline-none transition-all focus-visible:shadow-dd-focus group",
                      isActive(item.href, true) ? "bg-dd-accent-soft text-dd-accent" : "text-dd-muted hover:bg-dd-surface-2 hover:text-dd-text"
                    )}
                  >
                    <NavIcon icon={item.icon} isActive={isActive(item.href, true)} />
                    <span className="sidebar-label text-[13px] font-medium">{item.label}</span>
                  </Link>
                </SidebarTooltip>
              ) : null;
            })}

            {/* Settings (profile) stays its own unrelated item */}
            <SidebarTooltip collapsed={collapsed} label={PROFILE_NAV_ITEM.label}>
              <Link
                href={PROFILE_NAV_ITEM.href}
                onClick={onClose}
                aria-label={collapsed ? PROFILE_NAV_ITEM.label : undefined}
                aria-current={isActive(PROFILE_NAV_ITEM.href, true) ? "page" : undefined}
                className={cn(
                  collapsed ? "flex min-h-11 w-full items-center justify-center rounded-dd px-0 py-1 outline-none transition-all focus-visible:shadow-dd-focus group" : "flex min-h-11 items-center gap-3 px-3 py-1 rounded-dd outline-none transition-all focus-visible:shadow-dd-focus group",
                  isActive(PROFILE_NAV_ITEM.href, true) ? "bg-dd-accent-soft text-dd-accent" : "text-dd-muted hover:bg-dd-surface-2 hover:text-dd-text"
                )}
              >
                <NavIcon icon={PROFILE_NAV_ITEM.icon} isActive={isActive(PROFILE_NAV_ITEM.href, true)} />
                <span className="sidebar-label text-[13px] font-medium">{PROFILE_NAV_ITEM.label}</span>
              </Link>
            </SidebarTooltip>
          </div>
        </nav>

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

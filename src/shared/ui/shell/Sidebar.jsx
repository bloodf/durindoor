import { useState } from "react";

import { StatusDot } from "@/shared/ui/components/StatusDot";

/** Canonical dashboard navigation consumed by shell and page previews. */
export const NAV_GROUPS = [
  {
    label: "OBSERVE",
    items: [
      { label: "Usage", icon: "monitoring", href: "/dashboard/usage" },
      { label: "Timeline", icon: "timeline", href: "/dashboard/timeline" },
      { label: "Console Log", icon: "terminal", href: "/dashboard/console-log" },
    ],
  },
  {
    label: "ROUTE",
    items: [
      {
        label: "Providers",
        icon: "dns",
        href: "/dashboard/providers",
        status: "healthy",
      },
      { label: "Combos", icon: "layers", href: "/dashboard/combos" },
      { label: "MCP Gateway", icon: "hub", href: "/dashboard/mcp-gateway" },
      { label: "Proxy Pools", icon: "router", href: "/dashboard/proxy-pools" },
    ],
  },
  {
    label: "OPTIMIZE",
    items: [
      {
        label: "Token Saver",
        icon: "compress",
        href: "/dashboard/token-saver",
        children: [
          { label: "Statistics", href: "/dashboard/token-saver" },
          { label: "Settings", href: "/dashboard/token-saver/settings" },
          { label: "Headroom", href: "/dashboard/headroom" },
          { label: "Test Savers", href: "/dashboard/compression-studio" },
        ],
      },
    ],
  },
  {
    label: "MEDIA",
    items: [
      {
        label: "Embedding",
        icon: "deployed_code",
        href: "/dashboard/media-providers/embedding",
      },
      {
        label: "Text to Image",
        icon: "image",
        href: "/dashboard/media-providers/image",
      },
      {
        label: "Text to Speech",
        icon: "record_voice_over",
        href: "/dashboard/media-providers/tts",
      },
      {
        label: "Speech to Text",
        icon: "mic",
        href: "/dashboard/media-providers/stt",
      },
      {
        label: "Web Fetch & Search",
        icon: "travel_explore",
        href: "/dashboard/media-providers/web",
      },
    ],
  },
  {
    label: "SYSTEM",
    items: [
      { label: "Endpoint & Key", icon: "key", href: "/dashboard/endpoint" },
      { label: "CLI Tools", icon: "build", href: "/dashboard/cli-tools" },
      {
        label: "Auto-configure",
        icon: "auto_fix_high",
        href: "/dashboard/auto-configure",
      },
      { label: "Skills", icon: "extension", href: "/dashboard/skills" },
    ],
  },
  {
    label: "HELP",
    items: [
      { label: "API Docs", icon: "description", href: "/dashboard/api-docs" },
      { label: "MCP Help", icon: "help", href: "/dashboard/mcp-help" },
    ],
  },
];

/** Returns parent and child destinations in display order. */
export function flattenNav(groups = NAV_GROUPS) {
  return groups.flatMap((group) =>
    group.items.flatMap((item) => [item, ...(item.children ?? [])]),
  );
}

function pathMatches(activePath, href) {
  return activePath === href || activePath.startsWith(`${href}/`);
}

function itemIsActive(activePath, item) {
  return (
    pathMatches(activePath, item.href) ||
    item.children?.some((child) => pathMatches(activePath, child.href))
  );
}

function NavIcon({ name }) {
  return (
    <span
      aria-hidden="true"
      className="material-symbols-outlined shrink-0 text-[18px] leading-none"
    >
      {name}
    </span>
  );
}

/** Dashboard navigation with compact and expandable modes. */
export function Sidebar({
  activePath = "",
  collapsed = false,
  onNavigate,
  onToggleCollapse,
  className = "",
}) {
  const tokenSaver = NAV_GROUPS[2].items[0];
  const tokenSaverActive = itemIsActive(activePath, tokenSaver);
  const [tokenSaverOverride, setTokenSaverOverride] = useState(null);
  const manualTokenSaverExpanded =
    tokenSaverOverride?.activePath === activePath ? tokenSaverOverride.expanded : null;
  const tokenSaverExpanded = manualTokenSaverExpanded ?? tokenSaverActive;
  function navigate(event, href) {
    if (!onNavigate) return;
    event.preventDefault();
    onNavigate(href);
  }

  const rootClasses = [
    collapsed ? "w-16" : "w-64",
    "flex h-full shrink-0 flex-col overflow-hidden border-r border-dd-border bg-dd-surface transition-[width] duration-200",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <aside className={rootClasses} aria-label="Dashboard navigation">
      <div
        className={
          collapsed
            ? "flex h-14 shrink-0 items-center justify-center gap-0 border-b border-dd-border-subtle px-3"
            : "flex h-14 shrink-0 items-center gap-2.5 border-b border-dd-border-subtle px-3"
        }
      >
        <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-dd bg-dd-surface-3">
          {/* Static public asset required by shell branding. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/icon-512.png"
            alt={collapsed ? "DurinDoor" : ""}
            className="h-7 w-7 object-contain"
          />
        </div>
        <div
          className={
            collapsed
              ? "w-0 overflow-hidden whitespace-nowrap leading-tight opacity-0 transition-opacity duration-150"
              : "min-w-0 overflow-hidden whitespace-nowrap leading-tight opacity-100 transition-opacity duration-150"
          }
        >
          <div className="truncate text-[15px] font-semibold text-dd-text">DurinDoor</div>
          <div className="text-xs text-dd-muted">v3.18.1</div>
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {NAV_GROUPS.map((group) => (
          <section
            key={group.label}
            className={
              collapsed
                ? "border-b border-dd-border-subtle py-2 last:border-b-0"
                : "pb-1"
            }
            aria-label={group.label}
          >
            {!collapsed ? (
              <div className="px-3 pb-1 pt-4 text-[10px] font-semibold tracking-wider text-dd-subtle">
                {group.label}
              </div>
            ) : null}

            {group.items.map((item) => {
              const active = itemIsActive(activePath, item);
              const expandable = Boolean(item.children?.length);

              return (
                <div key={item.href}>
                  <div className="relative flex items-center">
                    {active ? (
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-1 left-0 w-0.5 bg-dd-accent"
                      />
                    ) : null}
                    <a
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      aria-current={activePath === item.href ? "page" : undefined}
                      onClick={(event) => navigate(event, item.href)}
                      className={
                        active
                          ? collapsed
                            ? "flex h-8 min-w-0 flex-1 items-center justify-center rounded-dd bg-dd-accent-soft px-0 text-[13px] font-medium text-dd-accent outline-none focus-visible:shadow-dd-focus"
                            : "flex h-8 min-w-0 flex-1 items-center gap-2.5 rounded-dd bg-dd-accent-soft px-3 text-[13px] font-medium text-dd-accent outline-none focus-visible:shadow-dd-focus"
                          : collapsed
                            ? "flex h-8 min-w-0 flex-1 items-center justify-center rounded-dd px-0 text-[13px] font-medium text-dd-muted outline-none hover:bg-dd-surface-2 hover:text-dd-text focus-visible:shadow-dd-focus"
                            : "flex h-8 min-w-0 flex-1 items-center gap-2.5 rounded-dd px-3 text-[13px] font-medium text-dd-muted outline-none hover:bg-dd-surface-2 hover:text-dd-text focus-visible:shadow-dd-focus"
                      }
                    >
                      <NavIcon name={item.icon} />
                      <span
                        className={
                          collapsed
                            ? "w-0 overflow-hidden whitespace-nowrap opacity-0 transition-opacity duration-150"
                            : "truncate whitespace-nowrap opacity-100 transition-opacity duration-150"
                        }
                      >
                        {item.label}
                      </span>
                      {!collapsed && item.status === "healthy" ? (
                        <StatusDot
                          tone="success"
                          className="ml-auto"
                          aria-label="Healthy"
                          title="Healthy"
                        />
                      ) : null}
                    </a>
                    {!collapsed && expandable ? (
                      <button
                        type="button"
                        aria-label={
                          tokenSaverExpanded ? "Collapse Token Saver" : "Expand Token Saver"
                        }
                        aria-expanded={tokenSaverExpanded}
                        onClick={() =>
                          setTokenSaverOverride({
                            activePath,
                            expanded: !tokenSaverExpanded,
                          })
                        }
                        className="absolute right-1 inline-flex size-7 items-center justify-center rounded-dd text-dd-muted outline-none hover:bg-dd-surface-2 hover:text-dd-text focus-visible:shadow-dd-focus"
                      >
                        <span
                          aria-hidden="true"
                          className="material-symbols-outlined text-[17px] leading-none"
                        >
                          {tokenSaverExpanded ? "expand_less" : "expand_more"}
                        </span>
                      </button>
                    ) : null}
                  </div>

                  {!collapsed && expandable && tokenSaverExpanded ? (
                    <div className="ml-4 border-l border-dd-border-subtle pl-2">
                      {item.children.map((child) => {
                        const childActive = activePath === child.href;
                        return (
                          <a
                            key={child.href}
                            href={child.href}
                            aria-current={childActive ? "page" : undefined}
                            onClick={(event) => navigate(event, child.href)}
                            className={
                              childActive
                                ? "flex h-7 items-center rounded-dd bg-dd-accent-soft px-3 text-xs font-medium text-dd-accent outline-none focus-visible:shadow-dd-focus"
                                : "flex h-7 items-center rounded-dd px-3 text-xs font-medium text-dd-muted outline-none hover:bg-dd-surface-2 hover:text-dd-text focus-visible:shadow-dd-focus"
                            }
                          >
                            {child.label}
                          </a>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </section>
        ))}
      </nav>

      {onToggleCollapse ? (
        <div className="shrink-0 px-2 pb-2">
          <button
            type="button"
            title={collapsed ? "Expand sidebar" : undefined}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={onToggleCollapse}
            className={
              collapsed
                ? "flex h-8 w-full items-center justify-center rounded-dd px-3 text-[13px] text-dd-muted outline-none hover:bg-dd-surface-2 hover:text-dd-text focus-visible:shadow-dd-focus"
                : "flex h-8 w-full items-center gap-2.5 rounded-dd px-3 text-[13px] text-dd-muted outline-none hover:bg-dd-surface-2 hover:text-dd-text focus-visible:shadow-dd-focus"
            }
          >
            <NavIcon name={collapsed ? "chevron_right" : "chevron_left"} />
            <span
              className={
                collapsed
                  ? "w-0 overflow-hidden whitespace-nowrap opacity-0 transition-opacity duration-150"
                  : "overflow-hidden whitespace-nowrap opacity-100 transition-opacity duration-150"
              }
            >
              Collapse
            </span>
          </button>
        </div>
      ) : null}

      <div className="shrink-0 border-t border-dd-border-subtle p-2">
        <a
          href="/dashboard/profile"
          title={collapsed ? "Settings" : undefined}
          aria-current={pathMatches(activePath, "/dashboard/profile") ? "page" : undefined}
          onClick={(event) => navigate(event, "/dashboard/profile")}
          className={
            pathMatches(activePath, "/dashboard/profile")
              ? collapsed
                ? "relative flex h-8 items-center justify-center rounded-dd bg-dd-accent-soft px-0 text-[13px] font-medium text-dd-accent outline-none focus-visible:shadow-dd-focus"
                : "relative flex h-8 items-center gap-2.5 rounded-dd bg-dd-accent-soft px-3 text-[13px] font-medium text-dd-accent outline-none focus-visible:shadow-dd-focus"
              : collapsed
                ? "flex h-8 items-center justify-center rounded-dd px-0 text-[13px] font-medium text-dd-muted outline-none hover:bg-dd-surface-2 hover:text-dd-text focus-visible:shadow-dd-focus"
                : "flex h-8 items-center gap-2.5 rounded-dd px-3 text-[13px] font-medium text-dd-muted outline-none hover:bg-dd-surface-2 hover:text-dd-text focus-visible:shadow-dd-focus"
          }
        >
          {pathMatches(activePath, "/dashboard/profile") ? (
            <span aria-hidden="true" className="absolute inset-y-1 left-0 w-0.5 bg-dd-accent" />
          ) : null}
          <NavIcon name="settings" />
          <span
            className={
              collapsed
                ? "w-0 overflow-hidden whitespace-nowrap opacity-0 transition-opacity duration-150"
                : "overflow-hidden whitespace-nowrap opacity-100 transition-opacity duration-150"
            }
          >
            Settings
          </span>
        </a>
      </div>
    </aside>
  );
}

export default Sidebar;

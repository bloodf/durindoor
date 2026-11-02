import { REVIEW_SURFACES } from "./review-manifest.js";

/** The proposed workspace navigation is scoped to the Storybook review. */
export function reviewSidebarSections(sections) {
  if (globalThis.document?.documentElement.dataset.v5Review !== "true") return sections;
  const icons = {
    "/dashboard/console-log": "console_log",
    "/dashboard/cli-tools": "cli_tools",
    "/dashboard/token-saver": "token_saver_stats",
    "/dashboard/token-saver/settings": "token_saver_settings",
    "/dashboard/mcp-gateway": "mcp_instances",
    "/dashboard/mcp-gateway/keys": "mcp_keys",
  };
  const withIcon = (entry) => {
    const updated = { ...entry, icon: icons[entry.href] || entry.icon };
    if (entry.children) updated.children = entry.children.map(withIcon);
    return updated;
  };
  return sections.map((section) => ({ ...section, entries: section.entries.map(withIcon) })).map((section) => section.key !== "monitor" ? section : {
    ...section,
    entries: [{ type: "item", href: "/dashboard/workspaces", label: "My dashboards", icon: "dashboard", exact: true }, ...section.entries],
  }).map((section) => section.key !== "optimize" ? section : { ...section, entries: section.entries.map((entry) => entry.type !== "group" || entry.key !== "token-saver" ? entry : { ...entry, children: entry.children.map((child) => child.href === "/dashboard/token-saver" ? { ...child, label: "Dashboard" } : child) }) });
}

/** Concrete routes win over parameterized routes. Page stories win over
 * incidental component stories in the same directory. This prevents Settings
 * navigation opening a transfer panel or Web opening a generic media alias.
 */
export function surfaceForRoute(route, surfaces = REVIEW_SURFACES) {
  const pathname = route.split("?")[0];
  const path = pathname === "/dashboard" ? "/dashboard/usage" : pathname;
  const candidates = surfaces.filter((surface) => surface.routePattern && new RegExp(`^${surface.routePattern}$`).test(path));
  const parameterCount = (surface) => surface.routePattern.split("[^/]+").length - 1;
  const page = (surface) => surface.source.endsWith("/page.stories.jsx") ? 1 : 0;
  return candidates.sort((a, b) => parameterCount(a) - parameterCount(b) || b.routePattern.length - a.routePattern.length || (b.routePriority || 0) - (a.routePriority || 0) || page(b) - page(a))[0];
}

/** Component stories have their own canvas instead of borrowing a page shell. */
export function isReviewComponent(source, explicit = false) {
  return explicit || ((source.startsWith("src/shared/") || source.includes("/components/")) && !source.includes("/ui/v5/"))
    || (source.startsWith("src/app/") && !/\/(?:page|error|[^/]*Client)\.stories\.jsx$/.test(source));
}

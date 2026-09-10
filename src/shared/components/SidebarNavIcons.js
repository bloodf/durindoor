// Sidebar navigation data model, icon constants, and helpers.
//
// This module is deliberately JSX-free so unit tests can import the nav
// structure and the NavIcon helper without a JSX transformer. Sidebar.js
// renders these sections and calls NavIcon inside the JSX tree.
//
// NAV_SECTIONS is the single source of truth for the dashboard information
// architecture. Every dashboard route appears exactly once, grouped into five
// labeled SaaS-style sections, top to bottom:
//
//   MONITOR    — observe traffic and provider state
//   BUILD      — configure routing and credentials
//   OPTIMIZE   — token-saving tooling
//   INTEGRATE  — connect external clients and media kinds
//   REFERENCE  — documentation and debugging aids
//
// Settings (profile) is not part of NAV_SECTIONS; PROFILE_NAV_ITEM is pinned
// at the bottom of the rail, above the collapse toggle.
//
// Entry shapes:
//   item  — { type: "item", href, label, icon, exact?, requiresTranslator? }
//           `exact` defaults to prefix matching; `requiresTranslator` entries
//           are hidden unless the translator feature flag is enabled.
//   group — { type: "group", key, label, icon, children: [<item-like>] }
//           collapsible parent; collapsed rail links to the first child.
//   media — { type: "media", key, label, icon, basePath }
//           Media Providers accordion; children are resolved at render time
//           from MEDIA_PROVIDER_KINDS + COMBINED_WEB_ITEM.

import { createElement } from "react";
import { cn } from "@/shared/utils/cn";

// Segment-boundary active check.
// Returns true when the current pathname starts with href, with three guards:
// 1. The dashboard root redirect page never counts as active.
// 2. exact=true requires an equal pathname (used for leaf nav items to
//    avoid a parent route lighting up a sibling child page).
// 3. Non-exact matches only succeed when the path continues past a '/' boundary
//    (so /dashboard/media-providers/image matches /dashboard/media-providers,
//    but /dashboard/media-providers-foo does not).
export function isActivePath(pathname, href, exact = false) {
  if (!pathname || href === "/dashboard") return false;
  if (exact) return pathname === href;
  return pathname.startsWith(`${href}/`) || pathname === href;
}

// const VISIBLE_MEDIA_KINDS = ["embedding", "image", "imageToText", "tts", "stt", "webSearch", "webFetch", "video", "music"];
export const VISIBLE_MEDIA_KINDS = ["embedding", "image", "tts", "stt"];
// Combined entry: webSearch + webFetch share one page at /dashboard/media-providers/web
export const COMBINED_WEB_ITEM = { id: "web", label: "Web Fetch & Search", icon: "travel_explore", href: "/dashboard/media-providers/web" };

export const BRAND_LOGO_SRC = "/icons/icon-512.png";
export const BRAND_LOGO_ALT = "";

// Labeled navigation sections. Usage is the dashboard home (the root
// /dashboard route redirects to /dashboard/usage).
export const NAV_SECTIONS = [
  {
    key: "monitor",
    label: "Monitor",
    entries: [
      { type: "item", href: "/dashboard/usage", label: "Usage", icon: "bar_chart" },
      { type: "item", href: "/dashboard/timeline", label: "Timeline", icon: "timeline" },
      { type: "item", href: "/dashboard/quota", label: "Quota Tracker", icon: "data_usage" },
      { type: "item", href: "/dashboard/health", label: "Health", icon: "monitor_heart" },
      { type: "item", href: "/dashboard/console-log", label: "Console Log", icon: "terminal", exact: true },
    ],
  },
  {
    key: "build",
    label: "Build",
    entries: [
      { type: "item", href: "/dashboard/playground", label: "Playground", icon: "chat" },
      { type: "item", href: "/dashboard/combos", label: "Combos", icon: "layers" },
      // Providers links straight to the configuration grid; Health and Quota
      // Tracker live under Monitor.
      { type: "item", href: "/dashboard/providers", label: "Providers", icon: "dns", exact: false },
      { type: "item", href: "/dashboard/endpoint", label: "Endpoint & Key", icon: "api" },
      { type: "item", href: "/dashboard/proxy-pools", label: "Proxy Pools", icon: "lan" },
    ],
  },
  {
    key: "optimize",
    label: "Optimize",
    entries: [
      // Token Saver: Statistics renders the overview dashboard; Settings holds
      // the RTK/Headroom/PXPIPE toggles. Headroom (full-page UI owned by the
      // HeadroomWebui worker) and Test Savers (compression preview studio) are
      // sibling entries, not children.
      {
        type: "group",
        key: "token-saver",
        label: "Token Saver",
        icon: "savings",
        children: [
          { href: "/dashboard/token-saver", label: "Statistics", icon: "bar_chart" },
          { href: "/dashboard/token-saver/settings", label: "Settings", icon: "settings" },
        ],
      },
      { type: "item", href: "/dashboard/headroom", label: "Headroom", icon: "memory" },
      { type: "item", href: "/dashboard/compression-studio", label: "Test Savers", icon: "compress" },
    ],
  },
  {
    key: "integrate",
    label: "Integrate",
    entries: [
      { type: "item", href: "/dashboard/mcp-gateway", label: "MCP Gateway", icon: "hub", exact: false },
      { type: "item", href: "/dashboard/cli-tools", label: "CLI Tools", icon: "terminal", exact: false },
      { type: "item", href: "/dashboard/skills", label: "Skills", icon: "extension" },
      { type: "item", href: "/dashboard/auto-configure", label: "Auto-configure", icon: "auto_fix" },
      { type: "media", key: "media-providers", label: "Media Providers", icon: "perm_media", basePath: "/dashboard/media-providers" },
    ],
  },
  {
    key: "reference",
    label: "Reference",
    entries: [
      { type: "item", href: "/dashboard/api-docs", label: "API Docs", icon: "description" },
      { type: "item", href: "/dashboard/mcp-help", label: "MCP Help", icon: "help" },
      { type: "item", href: "/dashboard/translator", label: "Translator", icon: "translate", exact: true, requiresTranslator: true },
    ],
  },
];

// Profile/settings is rendered pinned at the bottom of the rail so it stays
// unrelated to the Token Saver Settings page; it keeps its own icon and label.
export const PROFILE_NAV_ITEM = { href: "/dashboard/profile", label: "Settings", icon: "settings" };

/**
 * Render a sidebar navigation icon.
 *
 * The brand logo is the only non-Material-Symbol asset in the sidebar today.
 * Generic nav items continue to use Material Symbols because the project does not
 * ship a bespoke nav icon set; replacing them would require new assets or a
 * dependency we do not have. If a dedicated nav icon set is added later, this
 * helper can branch on `item.icon` to render an SVG component instead.
 */
export function NavIcon({ icon, isActive, size = "18" }) {
  return createElement(
    "span",
    {
      "aria-hidden": true,
      className: cn(
        "material-symbols-outlined",
        size === "16" ? "text-[16px]" : "text-[18px]",
        isActive ? "fill-1" : "group-hover:text-dd-accent transition-colors"
      ),
    },
    icon
  );
}

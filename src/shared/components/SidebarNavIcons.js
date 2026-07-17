// Sidebar navigation icon constants and helper.
//
// This module is deliberately JSX-free so unit tests can import the icon
// mapping and the NavIcon helper without a JSX transformer. Sidebar.js
// imports the same values and calls NavIcon for rendering in the JSX tree.

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

// Top-level dashboard navigation. Usage is the dashboard home (the root
// /dashboard route redirects to /dashboard/usage).
export const navItems = [
  { href: "/dashboard/usage", label: "Usage", icon: "bar_chart" },
  { href: "/dashboard/providers", label: "Providers", icon: "dns", exact: false },
  { href: "/dashboard/playground", label: "Playground", icon: "chat" },
  { href: "/dashboard/combos", label: "Combos", icon: "layers" },
  { href: "/dashboard/quota", label: "Quota Tracker", icon: "data_usage" },
  { href: "/dashboard/health", label: "Provider Health", icon: "monitor_heart" },
  { href: "/dashboard/compression-studio", label: "Compression Studio", icon: "compress" },
  { href: "/dashboard/mcp-gateway", label: "MCP Gateway", icon: "hub", exact: false },
];

// Collapsible Token Saver menu. Statistics renders the overview dashboard;
// Settings holds the RTK/Headroom/PXPIPE toggles; Headroom links to the
// dedicated full-page UI owned by the HeadroomWebui worker.
export const tokenSaverMenu = {
  icon: "savings",
  label: "Token Saver",
  children: [
    { href: "/dashboard/token-saver", label: "Statistics", icon: "bar_chart" },
    { href: "/dashboard/token-saver/settings", label: "Settings", icon: "settings" },
    { href: "/dashboard/headroom", label: "Headroom", icon: "memory" },
  ],
};

export const debugItems = [
  { href: "/dashboard/console-log", label: "Console Log", icon: "terminal" },
  { href: "/dashboard/translator", label: "Translator", icon: "translate" },
];

// Endpoint & Key and CLI Tools moved under System per the V2.1 nav restructure.
export const systemItems = [
  { href: "/dashboard/endpoint", label: "Endpoint & Key", icon: "api" },
  { href: "/dashboard/cli-tools", label: "CLI Tools", icon: "terminal", exact: false },
  { href: "/dashboard/proxy-pools", label: "Proxy Pools", icon: "lan" },
  { href: "/dashboard/skills", label: "Skills", icon: "extension" },
];

// Profile/settings is rendered separately so it stays unrelated to the Token
// Saver Settings page; it keeps its own icon and label in the System section.
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
      className: cn(
        "material-symbols-outlined",
        size === "16" ? "text-[16px]" : "text-[18px]",
        isActive ? "fill-1" : "group-hover:text-primary transition-colors"
      ),
    },
    icon
  );
}

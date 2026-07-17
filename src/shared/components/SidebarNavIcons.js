// Sidebar navigation icon constants and helper.
//
// This module is deliberately JSX-free so unit tests can import the icon
// mapping and the NavIcon helper without a JSX transformer. Sidebar.js
// imports the same values and calls NavIcon for rendering in the JSX tree.

import { createElement } from "react";
import { cn } from "@/shared/utils/cn";

// const VISIBLE_MEDIA_KINDS = ["embedding", "image", "imageToText", "tts", "stt", "webSearch", "webFetch", "video", "music"];
export const VISIBLE_MEDIA_KINDS = ["embedding", "image", "tts", "stt"];
// Combined entry: webSearch + webFetch share one page at /dashboard/media-providers/web
export const COMBINED_WEB_ITEM = { id: "web", label: "Web Fetch & Search", icon: "travel_explore", href: "/dashboard/media-providers/web" };

export const BRAND_LOGO_SRC = "/icons/icon-192.svg";
export const BRAND_LOGO_ALT = "";

export const navItems = [
  { href: "/dashboard/endpoint", label: "Endpoint & Key", icon: "api" },
  { href: "/dashboard/providers", label: "Providers", icon: "dns" },
  { href: "/dashboard/playground", label: "Playground", icon: "chat" },
  { href: "/dashboard/combos", label: "Combos", icon: "layers" },
  { href: "/dashboard/usage", label: "Usage", icon: "bar_chart" },
  { href: "/dashboard/quota", label: "Quota Tracker", icon: "data_usage" },
  { href: "/dashboard/health", label: "Provider Health", icon: "monitor_heart" },
  { href: "/dashboard/free-provider-rankings", label: "Free Providers", icon: "leaderboard" },
  { href: "/dashboard/token-saver", label: "Token Saver", icon: "savings" },
  { href: "/dashboard/compression-studio", label: "Compression Studio", icon: "compress" },
  { href: "/dashboard/pxpipe", label: "PXPIPE", icon: "image" },
  { href: "/dashboard/cli-tools", label: "CLI Tools", icon: "terminal" },
  { href: "/dashboard/mcp-gateway", label: "MCP Gateway", icon: "hub" },
];

export const debugItems = [
  { href: "/dashboard/console-log", label: "Console Log", icon: "terminal" },
  { href: "/dashboard/translator", label: "Translator", icon: "translate" },
];

export const systemItems = [
  { href: "/dashboard/proxy-pools", label: "Proxy Pools", icon: "lan" },
  { href: "/dashboard/skills", label: "Skills", icon: "extension" },
];

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

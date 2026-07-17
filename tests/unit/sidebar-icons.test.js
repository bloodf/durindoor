import { createElement } from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  navItems,
  debugItems,
  systemItems,
  tokenSaverMenu,
  providersMenu,
  COMBINED_WEB_ITEM,
  PROFILE_NAV_ITEM,
  BRAND_LOGO_SRC,
  BRAND_LOGO_ALT,
  NavIcon,
  isActivePath,
} from "../../src/shared/components/SidebarNavIcons";

describe("SidebarNavIcons", () => {
  it("maps top nav labels to expected icon glyphs", () => {
    const map = new Map(navItems.map((i) => [i.label, i.icon]));
    expect(map.get("Usage")).toBe("bar_chart");
    expect(map.get("Playground")).toBe("chat");
    expect(map.get("Combos")).toBe("layers");
    expect(map.get("Quota Tracker")).toBe("data_usage");
    expect(map.get("Provider Health")).toBe("monitor_heart");
    expect(map.get("MCP Gateway")).toBe("hub");
  });

  it("does not include removed or relocated entries in top nav", () => {
    const labels = new Set(navItems.map((i) => i.label));
    expect(labels).not.toContain("Providers");
    expect(labels).not.toContain("Endpoint & Key");
    expect(labels).not.toContain("CLI Tools");
    expect(labels).not.toContain("Token Saver");
    expect(labels).not.toContain("PXPIPE");
    expect(labels).not.toContain("Free Providers");
  });

  it("centralizes debug and combined web icon glyphs", () => {
    expect(debugItems.map((i) => [i.label, i.icon])).toEqual([
      ["Console Log", "terminal"],
      ["Translator", "translate"],
    ]);
    expect(COMBINED_WEB_ITEM).toMatchObject({
      label: "Web Fetch & Search",
      icon: "travel_explore",
    });
  });

  it("moves endpoint, key, and CLI tools into system items", () => {
    const map = new Map(systemItems.map((i) => [i.label, i.icon]));
    expect(map.get("Endpoint & Key")).toBe("api");
    expect(map.get("CLI Tools")).toBe("terminal");
    expect(map.get("Proxy Pools")).toBe("lan");
    expect(map.get("Skills")).toBe("extension");
  });

  it("exposes a collapsible providers menu with configuration, health and quota", () => {
    expect(providersMenu.label).toBe("Providers");
    expect(providersMenu.icon).toBe("dns");
    expect(providersMenu.children.map((c) => c.label)).toEqual([
      "Configuration",
      "Health",
      "Quota Tracker",
    ]);
    expect(providersMenu.children.map((c) => c.href)).toEqual([
      "/dashboard/providers",
      "/dashboard/health",
      "/dashboard/quota",
    ]);
    const config = providersMenu.children.find((c) => c.href === "/dashboard/providers");
    expect(config.exact).toBe(false);
  });

  it("exposes a collapsible token saver menu with statistics, settings and headroom", () => {
    expect(tokenSaverMenu.label).toBe("Token Saver");
    expect(tokenSaverMenu.icon).toBe("savings");
    expect(tokenSaverMenu.children.map((c) => c.label)).toEqual([
      "Statistics",
      "Settings",
      "Headroom",
      "Test Savers",
    ]);
    expect(tokenSaverMenu.children.map((c) => c.href)).toEqual([
      "/dashboard/token-saver",
      "/dashboard/token-saver/settings",
      "/dashboard/headroom",
      "/dashboard/compression-studio",
    ]);
  });

  it("keeps profile settings separate from token saver settings", () => {
    expect(PROFILE_NAV_ITEM).toMatchObject({
      href: "/dashboard/profile",
      label: "Settings",
      icon: "settings",
    });
    const tokenSaverHrefs = new Set(tokenSaverMenu.children.map((c) => c.href));
    expect(tokenSaverHrefs).not.toContain(PROFILE_NAV_ITEM.href);
  });

  describe("isActivePath", () => {
    it("marks exact leaf routes active", () => {
      expect(isActivePath("/dashboard/usage", "/dashboard/usage")).toBe(true);
      expect(isActivePath("/dashboard/usage", "/dashboard/usage", true)).toBe(true);
    });

    it("does not treat dashboard root as active", () => {
      expect(isActivePath("/dashboard", "/dashboard")).toBe(false);
      expect(isActivePath("/dashboard/usage", "/dashboard")).toBe(false);
    });

    it("matches parent prefix only with trailing slash", () => {
      expect(isActivePath("/dashboard/media-providers/image", "/dashboard/media-providers")).toBe(true);
      expect(isActivePath("/dashboard/media-providers/web", "/dashboard/media-providers")).toBe(true);
      // Sibling paths without a slash boundary do not match.
      expect(isActivePath("/dashboard/media-providers-foo", "/dashboard/media-providers")).toBe(false);
    });

    it("uses exact mode to isolate statistics and settings siblings", () => {
      const stats = "/dashboard/token-saver";
      const settings = "/dashboard/token-saver/settings";
      expect(isActivePath(stats, stats, true)).toBe(true);
      expect(isActivePath(settings, stats, true)).toBe(false);
      expect(isActivePath(settings, settings, true)).toBe(true);
      expect(isActivePath(stats, settings, true)).toBe(false);
    });
  });

  it("marks nested top-level nav items as exact: false so children stay highlighted", () => {
    const providers = navItems.find((i) => i.href === "/dashboard/providers");
    expect(providers).toBeUndefined();
    const mcp = navItems.find((i) => i.href === "/dashboard/mcp-gateway");
    const cli = systemItems.find((i) => i.href === "/dashboard/cli-tools");
    const usage = navItems.find((i) => i.href === "/dashboard/usage");
    expect(mcp.exact).toBe(false);
    expect(cli.exact).toBe(false);
    expect(usage.exact).toBeUndefined();
  });

  it("NavIcon renders the requested Material Symbol glyph", () => {
    const el = NavIcon({ icon: "chat", isActive: true });
    const html = renderToStaticMarkup(el);
    expect(html).toContain(">chat<");
    expect(html).toContain("material-symbols-outlined");
    expect(html).toContain("fill-1");
  });

  it("NavIcon renders an inactive icon with hover classes", () => {
    const el = NavIcon({ icon: "chat", isActive: false });
    const html = renderToStaticMarkup(el);
    expect(html).toContain("group-hover:text-primary");
    expect(html).toContain("transition-colors");
    expect(html).not.toContain("fill-1");
  });

  it("NavIcon supports a smaller size", () => {
    const el = NavIcon({ icon: "chat", isActive: false, size: "16" });
    const html = renderToStaticMarkup(el);
    expect(html).toContain("text-[16px]");
    expect(html).not.toContain("text-[18px]");
  });

  it("brand logo points to the DurinDoor app icon with correct alt text", () => {
    expect(BRAND_LOGO_SRC).toBe("/icons/icon-512.png");
    expect(BRAND_LOGO_ALT).toBe("");
  });

  it("renders brand asset as an image with expected dimensions", () => {
    const img = createElement("img", {
      src: BRAND_LOGO_SRC,
      alt: BRAND_LOGO_ALT,
      width: 36,
      height: 36,
    });
    const html = renderToStaticMarkup(img);
    expect(html).toContain('src="/icons/icon-512.png"');
    expect(html).toContain('alt=""');
    expect(html).toContain('width="36"');
    expect(html).toContain('height="36"');
  });
});

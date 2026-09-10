import { createElement } from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  NAV_SECTIONS,
  COMBINED_WEB_ITEM,
  PROFILE_NAV_ITEM,
  BRAND_LOGO_SRC,
  BRAND_LOGO_ALT,
  NavIcon,
  isActivePath,
} from "../../src/shared/components/SidebarNavIcons";

const section = (key) => NAV_SECTIONS.find((s) => s.key === key);
const itemEntries = (key) => section(key).entries.filter((e) => e.type === "item");
const itemHrefs = (key) => itemEntries(key).map((e) => e.href);
const itemLabels = (key) => itemEntries(key).map((e) => e.label);
const allHrefs = () =>
  NAV_SECTIONS.flatMap((s) =>
    s.entries.flatMap((e) => (e.type === "group" ? e.children.map((c) => c.href) : e.type === "item" ? [e.href] : []))
  );

describe("SidebarNavIcons information architecture", () => {
  it("orders the five labeled sections MONITOR → BUILD → OPTIMIZE → INTEGRATE → REFERENCE", () => {
    expect(NAV_SECTIONS.map((s) => s.label)).toEqual([
      "Monitor",
      "Build",
      "Optimize",
      "Integrate",
      "Reference",
    ]);
  });

  it("groups observability routes under Monitor, lifting Quota Tracker and Health out of Providers", () => {
    expect(itemHrefs("monitor")).toEqual([
      "/dashboard/usage",
      "/dashboard/timeline",
      "/dashboard/quota",
      "/dashboard/health",
      "/dashboard/console-log",
    ]);
    expect(itemLabels("monitor")).toEqual([
      "Usage",
      "Timeline",
      "Quota Tracker",
      "Health",
      "Console Log",
    ]);
    const map = new Map(itemEntries("monitor").map((i) => [i.label, i.icon]));
    expect(map.get("Usage")).toBe("bar_chart");
    expect(map.get("Timeline")).toBe("timeline");
    expect(map.get("Quota Tracker")).toBe("data_usage");
    expect(map.get("Health")).toBe("monitor_heart");
    expect(map.get("Console Log")).toBe("terminal");
  });

  it("groups routing and credential routes under Build with Providers as a direct link", () => {
    expect(itemHrefs("build")).toEqual([
      "/dashboard/playground",
      "/dashboard/combos",
      "/dashboard/providers",
      "/dashboard/endpoint",
      "/dashboard/proxy-pools",
    ]);
    expect(itemLabels("build")).toEqual([
      "Playground",
      "Combos",
      "Providers",
      "Endpoint & Key",
      "Proxy Pools",
    ]);
    // Providers is no longer a collapsible group; it links straight to the
    // configuration grid and stays highlighted on child pages.
    expect(section("build").entries.some((e) => e.type === "group")).toBe(false);
    const providers = itemEntries("build").find((i) => i.href === "/dashboard/providers");
    expect(providers.exact).toBe(false);
  });

  it("groups token-saving tooling under Optimize with a collapsible Token Saver pair", () => {
    const tokenSaver = section("optimize").entries.find((e) => e.type === "group");
    expect(tokenSaver.label).toBe("Token Saver");
    expect(tokenSaver.icon).toBe("savings");
    expect(tokenSaver.children.map((c) => c.label)).toEqual(["Statistics", "Settings"]);
    expect(tokenSaver.children.map((c) => c.href)).toEqual([
      "/dashboard/token-saver",
      "/dashboard/token-saver/settings",
    ]);
    // Headroom and Test Savers are siblings, not Token Saver children.
    expect(itemHrefs("optimize")).toEqual([
      "/dashboard/headroom",
      "/dashboard/compression-studio",
    ]);
    expect(itemLabels("optimize")).toEqual(["Headroom", "Test Savers"]);
  });

  it("groups client/media integration routes under Integrate with the media accordion", () => {
    expect(itemHrefs("integrate")).toEqual([
      "/dashboard/mcp-gateway",
      "/dashboard/cli-tools",
      "/dashboard/skills",
      "/dashboard/auto-configure",
    ]);
    const media = section("integrate").entries.find((e) => e.type === "media");
    expect(media.label).toBe("Media Providers");
    expect(media.icon).toBe("perm_media");
    expect(media.basePath).toBe("/dashboard/media-providers");
  });

  it("groups docs and debug aids under Reference, with Translator feature-gated", () => {
    expect(itemLabels("reference")).toEqual(["API Docs", "MCP Help", "Translator"]);
    expect(itemHrefs("reference")).toEqual([
      "/dashboard/api-docs",
      "/dashboard/mcp-help",
      "/dashboard/translator",
    ]);
    const translator = itemEntries("reference").find((i) => i.label === "Translator");
    expect(translator.requiresTranslator).toBe(true);
  });

  it("keeps every dashboard route exactly once across sections", () => {
    const hrefs = allHrefs();
    expect(new Set(hrefs).size).toBe(hrefs.length);
    // Spot-check the relocated routes still exist somewhere.
    for (const href of [
      "/dashboard/quota",
      "/dashboard/health",
      "/dashboard/console-log",
      "/dashboard/endpoint",
      "/dashboard/proxy-pools",
      "/dashboard/mcp-gateway",
      "/dashboard/api-docs",
      "/dashboard/mcp-help",
    ]) {
      expect(hrefs).toContain(href);
    }
  });

  it("centralizes the combined web icon glyph", () => {
    expect(COMBINED_WEB_ITEM).toMatchObject({
      label: "Web Fetch & Search",
      icon: "travel_explore",
    });
  });

  it("keeps profile settings pinned outside the sections and separate from token saver settings", () => {
    expect(PROFILE_NAV_ITEM).toMatchObject({
      href: "/dashboard/profile",
      label: "Settings",
      icon: "settings",
    });
    expect(allHrefs()).not.toContain(PROFILE_NAV_ITEM.href);
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

  it("marks nested nav items as exact: false so children stay highlighted", () => {
    const mcp = itemEntries("integrate").find((i) => i.href === "/dashboard/mcp-gateway");
    const cli = itemEntries("integrate").find((i) => i.href === "/dashboard/cli-tools");
    const usage = itemEntries("monitor").find((i) => i.href === "/dashboard/usage");
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

import { createElement } from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  navItems,
  debugItems,
  systemItems,
  COMBINED_WEB_ITEM,
  BRAND_LOGO_SRC,
  BRAND_LOGO_ALT,
  NavIcon,
} from "../../src/shared/components/SidebarNavIcons";

describe("SidebarNavIcons", () => {
  it("maps every top nav label to its expected icon glyph", () => {
    const map = new Map(navItems.map((i) => [i.label, i.icon]));
    expect(map.get("Endpoint & Key")).toBe("api");
    expect(map.get("Providers")).toBe("dns");
    expect(map.get("Playground")).toBe("chat");
    expect(map.get("Combos")).toBe("layers");
    expect(map.get("Usage")).toBe("bar_chart");
    expect(map.get("Quota Tracker")).toBe("data_usage");
    expect(map.get("Provider Health")).toBe("monitor_heart");
    expect(map.get("Free Providers")).toBe("leaderboard");
    expect(map.get("Token Saver")).toBe("savings");
    expect(map.get("Compression Studio")).toBe("compress");
    expect(map.get("PXPIPE")).toBe("image");
    expect(map.get("CLI Tools")).toBe("terminal");
    expect(map.get("MCP Gateway")).toBe("hub");
  });

  it("centralizes debug, system and combined web icon glyphs", () => {
    expect(debugItems.map((i) => [i.label, i.icon])).toEqual([
      ["Console Log", "terminal"],
      ["Translator", "translate"],
    ]);
    expect(systemItems.map((i) => [i.label, i.icon])).toEqual([
      ["Proxy Pools", "lan"],
      ["Skills", "extension"],
    ]);
    expect(COMBINED_WEB_ITEM).toMatchObject({
      label: "Web Fetch & Search",
      icon: "travel_explore",
    });
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
    expect(BRAND_LOGO_SRC).toBe("/icons/icon-192.svg");
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
    expect(html).toContain('src="/icons/icon-192.svg"');
    expect(html).toContain('alt=""');
    expect(html).toContain('width="36"');
    expect(html).toContain('height="36"');
  });
});

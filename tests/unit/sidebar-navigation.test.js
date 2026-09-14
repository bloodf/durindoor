import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/dashboard/media-providers/web" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }) => createElement("a", { href, ...props }, children),
}));

import { Sidebar } from "../../src/shared/ui/shell/Sidebar.jsx";
import ProductionSidebar from "../../src/shared/components/Sidebar.js";

function openingTag(html, element, attribute) {
  const match = html.match(new RegExp(`<${element}[^>]*${attribute}[^>]*>`));
  expect(match, `${element} with ${attribute}`).not.toBeNull();
  return match[0];
}

function disclosureTag(html, label) {
  const match = html
    .match(/<button[^>]*aria-expanded="[^"]+"[^>]*>[\s\S]*?<\/button>/g)
    ?.find((button) => button.includes(`>${label}<`) || button.includes(`>${label}</span>`));
  expect(match, `disclosure labeled ${label}`).toBeDefined();
  return match.slice(0, match.indexOf(">") + 1);
}

describe("sidebar grouped navigation", () => {
  it("keeps expanded group neutral and exposes aria state only on selected leaf", () => {
    const html = renderToStaticMarkup(
      createElement(Sidebar, { activePath: "/dashboard/token-saver" }),
    );
    const disclosure = disclosureTag(html, "Token Saver");
    const statistics = openingTag(html, "a", 'href="/dashboard/token-saver"');
    const settings = openingTag(html, "a", 'href="/dashboard/token-saver/settings"');

    expect(disclosure).not.toContain("href=");
    expect(disclosure).toContain('aria-expanded="true"');
    expect(statistics).toContain('aria-current="page"');
    expect(settings).not.toContain("aria-current");
  });

  it("keeps active group route visible when children are collapsed away", () => {
    const html = renderToStaticMarkup(
      createElement(Sidebar, {
        activePath: "/dashboard/token-saver/settings",
        collapsed: true,
      }),
    );

    const tokenSaver = openingTag(html, "a", 'href="/dashboard/token-saver"');
    expect(tokenSaver).toContain("bg-dd-accent-soft");
    expect(html).not.toContain(">Statistics<");
  });

  it("marks combined web active in production without marking its expanded parent current", () => {
    const html = renderToStaticMarkup(createElement(ProductionSidebar));
    const disclosure = disclosureTag(html, "Media Providers");
    const web = openingTag(html, "a", 'href="/dashboard/media-providers/web"');

    expect(disclosure).not.toContain("aria-current");
    expect(web).toContain('aria-current="page"');
  });

  it.each(["/dashboard/media-providers/image/codex", "/dashboard/media-providers/combo/embedding-combo"])(
    "keeps the media group open on detail route %s",
    (pathname) => {
      navigation.pathname = pathname;
      try {
        const html = renderToStaticMarkup(createElement(ProductionSidebar));
        expect(disclosureTag(html, "Media Providers")).toContain('aria-expanded="true"');
        expect(openingTag(html, "a", 'href="/dashboard/media-providers/image"')).toBeDefined();
      } finally {
        navigation.pathname = "/dashboard/media-providers/web";
      }
    },
  );
});

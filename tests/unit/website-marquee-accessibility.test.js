import { describe, expect, it } from "vitest";
import React from "../../website/node_modules/react/index.js";
import { renderToStaticMarkup } from "../../website/node_modules/react-dom/server.node.js";
import ToolsMarquee from "../../website/src/components/home/sections/ToolsMarquee.jsx";
import { HomeLocaleProvider } from "../../website/src/i18n/HomeLocaleProvider.jsx";

describe("integration marquee accessibility", () => {
  it("keeps decorative link copies out of the keyboard and accessibility navigation", () => {
    const html = renderToStaticMarkup(React.createElement(HomeLocaleProvider, { locale: "en" }, React.createElement(ToolsMarquee)));
    const tracks = [...html.matchAll(/<ul\b([^>]*)>(.*?)<\/ul>/gs)];
    const original = tracks.find(([, attrs]) => attrs.includes('class="marquee-track"'));
    const duplicate = tracks.find(([, attrs]) => attrs.includes("is-clone"));
    expect(original[2]).toContain('href="/docs/integrations/');
    expect(original[1]).not.toContain("inert");
    expect(duplicate[2]).toBe(original[2]);
    expect(duplicate[1]).toContain('aria-hidden="true"');
    expect(duplicate[1]).toContain('inert=""');
  });
});

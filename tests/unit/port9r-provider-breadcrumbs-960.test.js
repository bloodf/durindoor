// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));

const { getPageInfo } = await import("../../src/shared/components/Header.js");

describe("dashboard header breadcrumbs (9router #960)", () => {
  it("titles free and web-cookie provider detail pages from the full provider map", () => {
    for (const id of ["opencode", "copilot-web"]) {
      const info = getPageInfo(`/dashboard/providers/${id}`);
      expect(info.title).toBeTruthy();
      expect(info.title).not.toBe("");
      expect(info.breadcrumbs).toEqual([
        { label: "Providers", href: "/dashboard/providers" },
        expect.objectContaining({ provider: id }),
      ]);
    }
  });

  it("does not repeat the media kind link as a separate Media Providers crumb", () => {
    const info = getPageInfo("/dashboard/media-providers/image/openai");
    const hrefs = info.breadcrumbs.filter((c) => c.href).map((c) => c.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(info.breadcrumbs.map((c) => c.label)).toEqual(["Text to Image", expect.any(String)]);
  });
});

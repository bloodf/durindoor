import { describe, it, expect, vi } from "vitest";

// The route module imports Next.js server helpers and app-local modules that
// are not resolvable in the plain node test environment; stub them so the pure
// HTML-rewrite helper can be imported directly.
vi.mock("next/server", () => ({ NextResponse: { json: () => ({}) } }));
vi.mock("@/lib/localDb", () => ({ getSettings: async () => ({}) }));
vi.mock("@/lib/headroom/detect", () => ({ DEFAULT_HEADROOM_URL: "http://127.0.0.1:8099" }));

const { rewriteDashboardHtml } = await import(
  "../../src/app/api/headroom/proxy/[...path]/route.js"
);

const PREFIX = "/api/headroom/proxy";

describe("rewriteDashboardHtml", () => {
  it("prefixes the settings fetch endpoint", () => {
    expect(rewriteDashboardHtml("fetch('/settings')")).toBe(`fetch('${PREFIX}/settings')`);
  });

  it("still prefixes the pre-existing endpoints", () => {
    for (const ep of ["stats", "health", "stats-history", "transformations/feed"]) {
      expect(rewriteDashboardHtml(`fetch('/${ep}')`)).toBe(`fetch('${PREFIX}/${ep}')`);
    }
  });

  it("rewrites dashboard static asset src/href paths", () => {
    expect(rewriteDashboardHtml('<script src="/dashboard/app.js"></script>')).toBe(
      `<script src="${PREFIX}/dashboard/app.js"></script>`,
    );
    expect(rewriteDashboardHtml('<link href="/dashboard/style.css">')).toBe(
      `<link href="${PREFIX}/dashboard/style.css">`,
    );
  });

  it("rewrites the bare dashboard link", () => {
    expect(rewriteDashboardHtml('<a href="/dashboard">home</a>')).toBe(
      `<a href="${PREFIX}/dashboard">home</a>`,
    );
  });

  it("leaves unrelated fetches and paths untouched", () => {
    expect(rewriteDashboardHtml("fetch('/other')")).toBe("fetch('/other')");
    expect(rewriteDashboardHtml('<img src="/notdashboard/x.png">')).toBe(
      '<img src="/notdashboard/x.png">',
    );
  });
});

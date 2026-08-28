import { afterEach, describe, it, expect, vi } from "vitest";

// The route module imports Next.js server helpers and app-local modules that
// are not resolvable in the plain node test environment; stub them so the pure
// HTML-rewrite helper can be imported directly.
vi.mock("next/server", () => ({ NextResponse: { json: () => ({}) } }));
vi.mock("@/lib/localDb", () => ({ getSettings: async () => ({}) }));
vi.mock("@/lib/headroom/detect", () => ({ DEFAULT_HEADROOM_URL: "http://127.0.0.1:8099" }));

const { DASHBOARD_PREFIX, forwardedHeaders, rewriteHeadroomHtml, rewriteLocation } = await import(
  "../../src/app/api/headroom/proxy/[...path]/route.js"
);

const PREFIX = DASHBOARD_PREFIX;

describe("rewriteHeadroomHtml", () => {
  it("rewrites allow-listed src/href/action and fetch literals", () => {
    const html = [
      '<script src="/assets/app.js?v=2"></script>',
      '<link href="/_next/static/css/app.css#x">',
      '<a href="/dashboard/sub?page=1">dash</a>',
      '<form action="/metrics"></form>',
      "fetch('/stats')",
      'fetch("/stats-history?from=1#top")',
      "fetch('/settings')",
      "fetch(`/health`)",
    ].join("");
    const out = rewriteHeadroomHtml(html);

    expect(out).toContain(`${PREFIX}/assets/app.js?v=2`);
    expect(out).toContain(`${PREFIX}/_next/static/css/app.css#x`);
    expect(out).toContain(`${PREFIX}/dashboard/sub?page=1`);
    expect(out).toContain(`${PREFIX}/metrics`);
    expect(out).toContain(`fetch('${PREFIX}/stats')`);
    expect(out).toContain(`fetch('${PREFIX}/settings')`);
    expect(out).toContain(`fetch("${PREFIX}/stats-history?from=1#top")`);
    expect(out).toContain(`fetch(\`${PREFIX}/health\`)`);
  });

  it("returns non-string and empty bodies unchanged", () => {
    expect(rewriteHeadroomHtml(null)).toBeNull();
    expect(rewriteHeadroomHtml(undefined)).toBeUndefined();
    expect(rewriteHeadroomHtml(0)).toBe(0);
    expect(rewriteHeadroomHtml("")).toBe("");
  });

  it("leaves unsafe, unknown, dynamic, and already-prefixed URLs untouched", () => {
    const html = [
      '<script src="https://cdn.example/x.js"></script>',
      '<script src="//cdn.example/y.js"></script>',
      '<img src="/unknown/x.png">',
      "fetch(`/stats/${page}`)",
      `fetch('${PREFIX}/stats')`,
    ].join("");

    expect(rewriteHeadroomHtml(html)).toBe(html);
  });
});

describe("rewriteLocation", () => {
  const target = new URL("http://127.0.0.1:8099/base");
  const base = new URL("http://127.0.0.1:8099/base");

  it("strips the configured base path from same-origin locations", () => {
    expect(rewriteLocation("/dashboard?next=1#top", target, base)).toBe(
      `${PREFIX}/dashboard?next=1#top`,
    );
    expect(rewriteLocation("http://127.0.0.1:8099/base/stats", target, base)).toBe(
      `${PREFIX}/stats`,
    );
  });

  it("preserves external, protocol-relative, non-http, and already-proxied locations", () => {
    expect(rewriteLocation("https://external.example/dashboard", target, base)).toBe(
      "https://external.example/dashboard",
    );
    expect(rewriteLocation("//external.example/dashboard", target, base)).toBe(
      "//external.example/dashboard",
    );
    expect(rewriteLocation("mailto:ops@example.com", target, base)).toBe(
      "mailto:ops@example.com",
    );
    expect(rewriteLocation(`${PREFIX}/dashboard`, target, base)).toBe(`${PREFIX}/dashboard`);
  });
});

describe("forwardedHeaders", () => {
  afterEach(() => {
    delete process.env.HEADROOM_API_KEY;
    delete process.env.HEADROOM_PROXY_TOKEN;
  });

  it("prefers the first forwarded proto/host and falls back to request origin", () => {
    const forwarded = forwardedHeaders({
      url: "http://internal:20128/api/headroom/proxy/dashboard",
      headers: new Headers({
        host: "internal:20128",
        "x-forwarded-proto": "https, http",
        "x-forwarded-host": "public.example, internal:20128",
      }),
    });
    expect(forwarded.get("x-forwarded-proto")).toBe("https");
    expect(forwarded.get("x-forwarded-host")).toBe("public.example");

    const fallback = forwardedHeaders({
      url: "https://dashboard.example/api/headroom/proxy/dashboard",
      headers: new Headers(),
    });
    expect(fallback.get("x-forwarded-proto")).toBe("https");
    expect(fallback.get("x-forwarded-host")).toBe("dashboard.example");
  });

  it("strips viewer and hop-by-hop credentials and never forwards HEADROOM_PROXY_TOKEN", () => {
    process.env.HEADROOM_PROXY_TOKEN = "proxy-secret";
    const headers = forwardedHeaders({
      url: "https://dashboard.example/api/headroom/proxy/dashboard",
      headers: new Headers({
        host: "dashboard.example",
        cookie: "auth_token=viewer-secret",
        authorization: "Bearer viewer-secret",
        connection: "keep-alive",
        "proxy-authorization": "Basic proxy-secret",
        "x-custom": "keep",
      }),
    });

    expect(headers.get("host")).toBeNull();
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("connection")).toBeNull();
    expect(headers.get("proxy-authorization")).toBeNull();
    expect(headers.get("x-custom")).toBe("keep");
  });
});

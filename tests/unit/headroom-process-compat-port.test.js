import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({ getSettings: vi.fn() }));
vi.mock("@/lib/headroom/detect", () => ({ DEFAULT_HEADROOM_URL: "http://127.0.0.1:8787" }));

import { rewriteHeadroomHtml } from "../../src/app/api/headroom/proxy/[...path]/route.js";

describe("Headroom dashboard compatibility", () => {
  it("routes fetchJson calls through the authenticated dashboard proxy", () => {
    const html = `this.fetchJson('/stats?cached=1'); fetchJson("/settings/schema"); fetch('/health');`;
    expect(rewriteHeadroomHtml(html)).toBe(
      `this.fetchJson('/api/headroom/proxy/stats?cached=1'); fetchJson("/api/headroom/proxy/settings/schema"); fetch('/api/headroom/proxy/health');`,
    );
  });

  it("leaves external, unknown, and already proxied URLs unchanged", () => {
    const html = `fetchJson('https://example.com/stats'); fetchJson('/unknown'); fetchJson('/api/headroom/proxy/stats');`;
    expect(rewriteHeadroomHtml(html)).toBe(html);
  });
});

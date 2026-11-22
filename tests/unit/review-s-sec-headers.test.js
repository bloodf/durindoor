import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import nextConfig from "../../next.config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const {
  BASELINE_SECURITY_HEADERS,
  installRequestWrapper,
} = require("../../custom-server.js");

const EXPECTED = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Content-Security-Policy":
    "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
};

describe("s-sec-headers (#2251)", () => {
  it("next.config.mjs headers() sends the baseline on /:path*", async () => {
    expect(nextConfig.headers).toEqual(expect.any(Function));
    const routes = await nextConfig.headers();
    const route = routes.find((entry) => entry.source === "/:path*");
    expect(route).toBeTruthy();
    const byKey = Object.fromEntries(route.headers.map((h) => [h.key, h.value]));
    expect(byKey).toMatchObject(EXPECTED);
    expect(byKey["Content-Security-Policy"]).not.toMatch(/script-src|style-src/);
  });

  it("custom-server stamps the same baseline before dispatch", async () => {
    expect(Object.fromEntries(BASELINE_SECURITY_HEADERS)).toEqual(EXPECTED);

    const fakeHttp = { createServer: vi.fn((handler) => ({ handler })) };
    const handler = vi.fn();
    installRequestWrapper({
      httpModule: fakeHttp,
      secret: "a".repeat(64),
      peerToken: "trusted-peer-token",
      verifyPeerOwner: vi.fn(async () => false),
    });
    const server = fakeHttp.createServer(handler);
    const setHeader = vi.fn();
    const request = {
      method: "GET",
      url: "/dashboard",
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
    };

    server.handler(request, { setHeader });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handler).toHaveBeenCalledOnce();
    for (const [key, value] of Object.entries(EXPECTED)) {
      expect(setHeader).toHaveBeenCalledWith(key, value);
    }
  });

  it("root layout does not claim a script-src 'self' CSP that is never sent", () => {
    const layout = readFileSync(resolve(root, "src/app/layout.js"), "utf8");
    expect(layout).not.toMatch(/script-src 'self'/);
    expect(layout).toMatch(/omits script-src/);
  });
});

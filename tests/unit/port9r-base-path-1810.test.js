import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ settings: vi.fn(async () => ({ requireLogin: true })) }));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.settings, validateApiKey: vi.fn(), validateGatewayKey: vi.fn(), getApiKeyByKey: vi.fn() }));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: vi.fn() }));
vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardAuthToken: vi.fn(async () => false) }));
vi.mock("@/lib/auth/trustedPeer", () => ({ hasTrustedPeerHeaders: () => false }));
vi.mock("next/server", () => ({ NextResponse: { redirect: (url) => ({ location: url.href }), next: () => ({ status: 200 }), json: (_, init) => ({ status: init.status }) } }));
const { proxy } = await import("../../src/dashboardGuard.js");

function request(path, basePath = "") {
  return { url: `https://example.test${basePath}${path}`, nextUrl: { pathname: path, basePath }, method: "GET", headers: new Headers({ host: "example.test" }), cookies: { get: () => undefined } };
}

describe("reverse proxy base path", () => {
  it("routes prefixed realtime upgrades and internal bridge requests", () => {
    const ws = createRequire(import.meta.url)("../../src/shared/utils/wsHandshake.js");
    const previous = process.env.DURINDOOR_BASE_PATH;
    process.env.DURINDOOR_BASE_PATH = "/router";
    try {
      expect(ws.isRealtimePath("/router/v1/realtime?model=x")).toBe(true);
      expect(ws.loopbackAuthUrl(20128)).toBe("http://127.0.0.1:20128/router/api/v1/realtime/auth");
    } finally {
      if (previous === undefined) delete process.env.DURINDOOR_BASE_PATH;
      else process.env.DURINDOOR_BASE_PATH = previous;
    }
  });
  it.each(["", "/router"])("keeps redirects and auth decisions at prefix %s", async (basePath) => {
    expect((await proxy(request("/", basePath))).location).toBe(`https://example.test${basePath}/dashboard`);
    expect((await proxy(request("/dashboard", basePath))).location).toBe(`https://example.test${basePath}/login`);
    expect((await proxy(request("/api/settings", basePath))).status).toBe(401);
  });

  it.each(["", "/router"])("prefixes same-origin browser API and streams only at %s", (basePath) => {
    const calls = [];
    class EventSource { constructor(url) { calls.push(url); } }
    const window = { location: { href: `https://example.test${basePath}/dashboard`, origin: "https://example.test" }, fetch: (input) => calls.push(input), EventSource };
    runInNewContext(readFileSync(new URL("../../public/base-path-bootstrap.js", import.meta.url), "utf8"), { document: { currentScript: { dataset: { basePath } } }, window, URL, Request });
    window.fetch("/api/settings");
    new window.EventSource("/api/usage/stream");
    window.fetch("https://other.test/api/settings");
    if (basePath) {
      window.fetch(new Request("https://example.test/api/settings", { method: "POST", body: "data" }));
      window.fetch("/router/api/settings");
      expect(calls[3].url).toBe("https://example.test/router/api/settings");
      expect(calls[3].method).toBe("POST");
      expect(calls[4]).toBe("/router/api/settings");
      calls.length = 3;
    }
    expect(calls).toEqual(basePath ? ["https://example.test/router/api/settings", "https://example.test/router/api/usage/stream", "https://other.test/api/settings"] : ["/api/settings", "/api/usage/stream", "https://other.test/api/settings"]);
  });
});

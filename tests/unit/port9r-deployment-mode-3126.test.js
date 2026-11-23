import { afterEach, describe, expect, it, vi } from "vitest";
import { isHosted } from "../../src/shared/utils/deploymentMode.js";
import { buildOAuthRedirectUri } from "../../src/lib/oauth/redirectUri.js";

const mocks = vi.hoisted(() => ({
  settings: vi.fn(async () => ({ requireLogin: false })),
  validate: vi.fn(async key => key === "valid"),
}));
vi.mock("next/server", () => ({ NextResponse: { next: () => ({ status: 200 }), json: (body, init) => ({ body, status: init.status }), redirect: () => ({ status: 307 }) } }));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.settings, validateApiKey: mocks.validate, getApiKeyByKey: vi.fn(), validateGatewayKey: vi.fn() }));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: async () => "cli" }));
vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardAuthToken: async () => false }));
vi.mock("@/lib/auth/trustedPeer", () => ({ hasTrustedPeerHeaders: () => true }));
import { proxy } from "../../src/dashboardGuard.js";

function request(path, headers = {}) {
  const url = new URL(`http://localhost:20128${path}`);
  return { url: url.href, nextUrl: url, method: "GET", headers: new Headers({ host: url.host, "x-9r-real-ip": "127.0.0.1", ...headers }), cookies: { get: () => undefined } };
}
afterEach(() => { delete process.env.DEPLOYMENT_MODE; delete process.env.NEXT_PUBLIC_BASE_URL; });
describe("hosted deployment", () => {
  it("requires credentials even for direct loopback and proxy peers", async () => {
    process.env.DEPLOYMENT_MODE = "hosted";
    expect((await proxy(request("/v1/chat/completions"))).status).toBe(401);
    expect((await proxy(request("/v1/chat/completions", { "x-9r-via-proxy": "1" }))).status).toBe(401);
    expect((await proxy(request("/v1/chat/completions", { authorization: "Bearer valid" }))).status).toBe(200);
    expect((await proxy(request("/v1/chat/completions", { "x-9r-via-proxy": "1", authorization: "Bearer valid" }))).status).toBe(200);
    expect((await proxy(request("/api/oauth/cursor/auto-import", { "x-9r-cli-token": "cli" }))).status).toBe(403);
    expect((await proxy(request("/dashboard"))).status).toBe(307);
    expect((await proxy(request("/api/mcp/control"))).status).toBe(401);
    expect((await proxy(request("/api/oauth/cursor/auto-import", { origin: "https://attacker.example" }))).status).toBe(403);
  });
  it("uses the public callback in hosted mode and rejects invalid modes", () => {
    process.env.DEPLOYMENT_MODE = "remote";
    expect(isHosted()).toBe(true);
    expect(buildOAuthRedirectUri({ origin: "https://example.com", hostname: "example.com" }, "codex", true)).toBe("https://example.com/callback");
    expect(buildOAuthRedirectUri({ origin: "https://example.com" }, "claude", true)).toContain("platform.claude.com");
    process.env.DEPLOYMENT_MODE = "typo";
    expect(() => isHosted()).toThrow();
  });
  it("fails closed when hosted storage is missing or unusable", async () => {
    process.env.DEPLOYMENT_MODE = "hosted";
    const previous = process.env.DATA_DIR;
    try {
      delete process.env.DATA_DIR;
      vi.resetModules();
      await expect(import("../../src/lib/dataDir.js")).rejects.toThrow("DATA_DIR");
      process.env.DATA_DIR = "/dev/null/unusable";
      vi.resetModules();
      await expect(import("../../src/lib/dataDir.js")).rejects.toThrow();
    } finally { if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous; }
  });
});

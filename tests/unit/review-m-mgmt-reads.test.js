import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  homedir: vi.fn(),
  validateApiKey: vi.fn(),
  getApiKeyByKey: vi.fn(),
  getSettings: vi.fn(),
  getConsistentMachineId: vi.fn(),
  verifyDashboardAuthToken: vi.fn(),
  hasTrustedPeerHeaders: vi.fn(() => true),
  resolveClientApiKey: vi.fn(),
  getApiKeyById: vi.fn(),
  getApiKeyProviderConnectionIds: vi.fn(),
  getApiKeyUsageLimitStatus: vi.fn(),
  getApiKeyUsageTotals: vi.fn(),
  getProviderConnections: vi.fn(),
  listProviderQuotaSnapshots: vi.fn(),
}));

vi.mock("os", () => ({ default: { homedir: mocks.homedir, platform: () => "linux" }, homedir: mocks.homedir, platform: () => "linux" }));
vi.mock("next/server", () => ({ NextResponse: { json: (body, init = {}) => new Response(JSON.stringify(body), { status: init.status ?? 200, headers: { "Content-Type": "application/json" } }) } }));
vi.mock("@/lib/localDb", () => mocks);
vi.mock("@/sse/services/auth.js", () => ({ resolveClientApiKey: mocks.resolveClientApiKey }));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: mocks.getConsistentMachineId }));
vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardAuthToken: mocks.verifyDashboardAuthToken }));
vi.mock("@/lib/auth/trustedPeer", () => ({ hasTrustedPeerHeaders: mocks.hasTrustedPeerHeaders }));

process.env.DURINDOOR_CONTROL_PROOF_SECRET = "m".repeat(64);

const { canAccessManagementApi } = await import("../../src/dashboardGuard.js");
const codex = await import("../../src/app/api/cli-tools/codex-settings/route.js");
const jcode = await import("../../src/app/api/cli-tools/jcode-settings/route.js");
const usageMe = await import("../../src/app/api/usage/me/route.js");

let home;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(process.cwd(), ".tmp-m-mgmt-reads-"));
  mocks.homedir.mockReturnValue(home);
  mocks.validateApiKey.mockResolvedValue(true);
  mocks.getApiKeyByKey.mockResolvedValue({ id: "key-1", isAdmin: false });
  mocks.getSettings.mockResolvedValue({ requireLogin: true });
  mocks.getConsistentMachineId.mockResolvedValue("machine-token");
  mocks.verifyDashboardAuthToken.mockResolvedValue(false);
  mocks.resolveClientApiKey.mockResolvedValue({ apiKey: "sk-valid", auth: { ok: true, stored: true, apiKeyId: "key-1" } });
  mocks.getApiKeyById.mockResolvedValue({ id: "key-1", name: "caller", isActive: true });
  mocks.getApiKeyProviderConnectionIds.mockResolvedValue([]);
  mocks.getApiKeyUsageLimitStatus.mockResolvedValue({ enforced: false });
  mocks.getApiKeyUsageTotals.mockResolvedValue({ totalTokens: 1 });
  mocks.getProviderConnections.mockResolvedValue([{ id: "other-connection", name: "other tenant" }]);
  mocks.listProviderQuotaSnapshots.mockResolvedValue([]);
});

afterEach(async () => fs.rm(home, { recursive: true, force: true }));

function keyedRequest(pathname, method = "GET") {
  return { method, nextUrl: { pathname }, headers: new Headers({ host: "router.example", authorization: "Bearer sk-valid" }), cookies: { get: () => undefined } };
}

describe("management reads by application API key", () => {
  it("denies non-admin management reads while retaining the scoped self-usage endpoint", async () => {
    for (const route of ["/api/timeline", "/api/translator/console-logs", "/api/keys", "/api/usage/stats", "/api/cli-tools/codex-settings"]) {
      expect(await canAccessManagementApi(keyedRequest(route)), route).toBe(false);
    }
    expect(await canAccessManagementApi(keyedRequest("/api/usage/me"))).toBe(true);
    expect(await canAccessManagementApi(keyedRequest("/api/usage/me", "POST"))).toBe(false);
  });

  it("allows admin-scoped keys to read management endpoints", async () => {
    mocks.getApiKeyByKey.mockResolvedValue({ id: "key-1", isAdmin: true });
    expect(await canAccessManagementApi(keyedRequest("/api/timeline"))).toBe(true);
  });

  it("does not expose the global connection inventory from self-usage for an unscoped key", async () => {
    const response = await usageMe.GET(new Request("http://localhost/api/usage/me", {
      headers: { authorization: "Bearer sk-valid" },
    }));
    const body = await response.json();
    expect(body.connections).toEqual([]);
    expect(mocks.getProviderConnections).not.toHaveBeenCalled();
  });

  it("redacts secrets from Codex and jcode settings responses", async () => {
    const codexPath = path.join(home, ".codex", "config.toml");
    await fs.mkdir(path.dirname(codexPath), { recursive: true });
    await fs.writeFile(codexPath, '[mcp_servers.github.env]\nGITHUB_TOKEN = "ghp_codex_secret"\nmodel = "safe-model"\n');
    const jcodePath = path.join(home, ".jcode", "config.toml");
    await fs.mkdir(path.dirname(jcodePath), { recursive: true });
    await fs.writeFile(jcodePath, '[providers.github]\napi_key = "jcode_secret"\nname = "safe-name"\n');

    const codexBody = await (await codex.GET()).json();
    const jcodeBody = await (await jcode.GET()).json();
    expect(codexBody.config).toContain("[REDACTED]");
    expect(codexBody.config).not.toContain("ghp_codex_secret");
    expect(jcodeBody.config.providers.github.api_key).toBe("[REDACTED]");
    expect(JSON.stringify(jcodeBody)).not.toContain("jcode_secret");
  });
});

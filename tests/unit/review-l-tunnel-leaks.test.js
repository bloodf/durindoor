import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settings: { requireLogin: true, tunnelDashboardAccess: true, tunnelUrl: "https://secret.trycloudflare.com", tailscaleUrl: "https://secret.ts.net" },
  proxyFetch: vi.fn(),
  pid: process.pid,
  clearPid: vi.fn(),
}));

vi.mock("next/server", () => ({ NextResponse: { json: (body, init) => Response.json(body, init) } }));
vi.mock("@/lib/localDb", () => ({ getSettings: async () => mocks.settings }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.proxyFetch }));
vi.mock("@/lib/tunnel/cloudflare/pid.js", () => ({
  savePid: vi.fn(), loadPid: () => mocks.pid, clearPid: mocks.clearPid,
}));

const { GET } = await import("../../src/app/api/settings/require-login/route.js");
const cloudflared = await import("../../src/lib/tunnel/cloudflare/cloudflared.js");
const { probeConnectionHealth } = await import("../../src/lib/providerHealthProbe.js");

describe("review l tunnel leak regressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settings = { requireLogin: true, tunnelDashboardAccess: true, tunnelUrl: "https://secret.trycloudflare.com", tailscaleUrl: "https://secret.ts.net" };
    mocks.pid = process.pid;
    mocks.proxyFetch.mockResolvedValue({ ok: true, status: 200 });
  });

  it("does not return ingress URLs from the public require-login bootstrap", async () => {
    const body = await (await GET()).json();
    expect(body).toEqual({ requireLogin: true, tunnelDashboardAccess: true });
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("clears a stale PID and never reports an unrelated process as cloudflared", () => {
    expect(cloudflared.isCloudflaredRunning()).toBe(false);
    expect(mocks.clearPid).toHaveBeenCalledOnce();
  });

  it("does not signal an unrelated process named by the stale PID file", () => {
    const kill = vi.spyOn(process, "kill");
    cloudflared.killCloudflared();
    expect(kill).not.toHaveBeenCalledWith(process.pid);
    kill.mockRestore();
  });

  it("routes a provider health probe through the configured proxy", async () => {
    const result = await probeConnectionHealth({
      provider: "openai-compatible-proxy-test",
      apiKey: "key",
      providerSpecificData: { baseUrl: "https://provider.example.test/v1" },
    }, { proxyConfig: { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.example.test:8080" } });

    expect(result).toMatchObject({ valid: true, status: 200 });
    expect(mocks.proxyFetch).toHaveBeenCalledWith(
      "https://provider.example.test/v1/models",
      expect.objectContaining({ redirect: "manual", headers: { Authorization: "Bearer key" } }),
      expect.objectContaining({ connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.example.test:8080" }),
    );
  });
});

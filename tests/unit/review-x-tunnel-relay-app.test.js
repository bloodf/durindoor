import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "tunnel-relay-test-"));
vi.mock("@/lib/dataDir.js", () => ({ DATA_DIR: temp }));
const fetchWorker = vi.fn(async () => ({ ok: true }));
vi.mock("@/lib/tunnel/cloudflare/workerFetch.js", () => ({ workerFetch: fetchWorker }));
vi.mock("@/lib/tunnel/cloudflare/cloudflared.js", () => ({
  spawnQuickTunnel: vi.fn(async () => ({ tunnelUrl: "https://direct.trycloudflare.com" })),
  killCloudflared: vi.fn(), isCloudflaredRunning: vi.fn(() => false), setUnexpectedExitHandler: vi.fn(),
}));
vi.mock("@/lib/tunnel/cloudflare/pid.js", () => ({ clearPid: vi.fn() }));
vi.mock("@/lib/tunnel/cloudflare/healthCheck.js", () => ({
  waitForHealth: vi.fn(async (urls) => urls.at(-1)), probeUrlAlive: vi.fn(async () => true),
}));
vi.mock("@/lib/localDb", () => ({ getSettings: vi.fn(async () => ({ tunnelEnabled: true })), updateSettings: vi.fn() }));
vi.mock("@/mitm/manager", () => ({ initDbHooks: vi.fn(), getCachedPassword: vi.fn(), loadEncryptedPassword: vi.fn() }));
const login = vi.fn(async () => ({ authUrl: "https://login.example" }));
vi.mock("@/lib/tunnel/tailscale/tailscale.js", () => ({
  startFunnel: vi.fn(), stopFunnel: vi.fn(), isTailscaleRunning: vi.fn(), isTailscaleRunningStrict: vi.fn(),
  isTailscaleLoggedIn: vi.fn(), isTailscaleLoggedInStrict: vi.fn(async () => false), isSystemDaemonRunning: vi.fn(),
  getActualFunnelUrl: vi.fn(), startLogin: login, startDaemonWithPassword: vi.fn(), provisionCert: vi.fn(),
}));
vi.mock("@/lib/tunnel/tailscale/healthCheck.js", () => ({ waitForHealth: vi.fn() }));

afterAll(() => fs.rmSync(temp, { recursive: true, force: true }));
afterEach(() => { vi.resetModules(); vi.unstubAllEnvs(); fetchWorker.mockClear(); });

describe("optional self-hosted relay", () => {
  it("uses only the quick URL without a configured relay", async () => {
    vi.stubEnv("TUNNEL_WORKER_URL", "");
    const { enableTunnel, getTunnelStatus } = await import("@/lib/tunnel/cloudflare/manager.js");
    expect((await enableTunnel()).publicUrl).toBe("");
    expect((await getTunnelStatus()).publicUrl).toBe("");
    expect(fetchWorker).not.toHaveBeenCalled();
  });

  it("persists private ownership and registers against the configured host", async () => {
    vi.stubEnv("TUNNEL_WORKER_URL", "https://relay.example");
    const manager = await import("@/lib/tunnel/cloudflare/manager.js");
    const result = await manager.enableTunnel();
    const stateFile = path.join(temp, "tunnel", "state.json");
    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    expect(state.ownershipSecret).toMatch(/^[a-f0-9]{64}$/);
    expect(fs.statSync(stateFile).mode & 0o777).toBe(0o600);
    expect(JSON.parse(fetchWorker.mock.calls.at(-1)[1].body).ownershipSecret).toBe(state.ownershipSecret);
    expect(result.publicUrl).toBe(`https://r${state.shortId}.relay.example`);
    vi.resetModules();
    const reloaded = await import("@/lib/tunnel/cloudflare/manager.js");
    await reloaded.enableTunnel();
    expect(JSON.parse(fetchWorker.mock.calls.at(-1)[1].body).ownershipSecret).toBe(state.ownershipSecret);
    vi.doMock("@/lib/tunnel", () => ({ getTunnelStatus: reloaded.getTunnelStatus, getTailscaleStatus: vi.fn(async () => ({})), getDownloadStatus: vi.fn(() => ({})) }));
    const { GET } = await import("@/app/api/tunnel/status/route.js");
    expect(await (await GET()).text()).not.toContain(state.ownershipSecret);
  });

  it("persists a separate Tailscale hostname", async () => {
    const { enableTailscale } = await import("@/lib/tunnel/tailscale/manager.js");
    await enableTailscale();
    const state = JSON.parse(fs.readFileSync(path.join(temp, "tunnel", "state.json"), "utf8"));
    expect(login).toHaveBeenCalledWith(state.tailscaleHostname);
    expect(state.tailscaleHostname).not.toBe(state.shortId);
  });
});

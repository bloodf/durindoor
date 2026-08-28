import { beforeEach, describe, expect, it, vi } from "vitest";

const loadState = vi.fn(() => ({ shortId: "abc123" }));
const saveState = vi.fn();
const generateShortId = vi.fn(() => "abc123");
vi.mock("@/lib/tunnel/shared/state.js", () => ({ loadState, saveState, generateShortId }));

const spawnQuickTunnel = vi.fn(async () => ({ tunnelUrl: "https://direct.trycloudflare.com" }));
const killCloudflared = vi.fn();
const isCloudflaredRunning = vi.fn(() => false);
const setUnexpectedExitHandler = vi.fn();
vi.mock("@/lib/tunnel/cloudflare/cloudflared.js", () => ({
  spawnQuickTunnel,
  killCloudflared,
  isCloudflaredRunning,
  setUnexpectedExitHandler,
}));
vi.mock("@/lib/tunnel/cloudflare/pid.js", () => ({ clearPid: vi.fn() }));

const waitForHealth = vi.fn(async () => "https://direct.trycloudflare.com");
const probeUrlAlive = vi.fn(async () => false);
vi.mock("@/lib/tunnel/cloudflare/healthCheck.js", () => ({ waitForHealth, probeUrlAlive }));
vi.mock("@/lib/tunnel/cloudflare/config.js", () => ({ WORKER_URL: "https://relay.example" }));

const updateSettings = vi.fn(async () => {});
vi.mock("@/lib/localDb", () => ({ getSettings: vi.fn(), updateSettings }));

const { enableTunnel } = await import("@/lib/tunnel/cloudflare/manager.js");

describe("enableTunnel health fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadState.mockReturnValue({ shortId: "abc123" });
    isCloudflaredRunning.mockReturnValue(false);
    spawnQuickTunnel.mockResolvedValue({ tunnelUrl: "https://direct.trycloudflare.com" });
    waitForHealth.mockResolvedValue("https://direct.trycloudflare.com");
    probeUrlAlive.mockResolvedValue(false);
    globalThis.fetch = vi.fn(async () => ({ ok: true }));
  });

  it("accepts the direct URL when relay registration is still unavailable", async () => {
    await expect(enableTunnel()).resolves.toMatchObject({ success: true });
    expect(waitForHealth).toHaveBeenCalledWith([
      "https://rabc123.abc-tunnel.us",
      "https://direct.trycloudflare.com",
    ], expect.any(Object));
  });

  it("keeps requiring both endpoints before reusing an existing process", async () => {
    isCloudflaredRunning.mockReturnValue(true);
    loadState.mockReturnValue({
      shortId: "abc123",
      tunnelUrl: "https://direct.trycloudflare.com",
    });
    probeUrlAlive.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await enableTunnel();

    expect(spawnQuickTunnel).toHaveBeenCalledOnce();
    expect(killCloudflared).toHaveBeenCalledOnce();
  });
});

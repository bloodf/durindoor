/**
 * Media routes count a keyless provider only when it is installed and working:
 * self-hosted servers must answer, local-device needs OS voices, and keyless
 * libraries / public services count as working.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getProviderConnections: vi.fn(async () => []), getSettings: vi.fn(async () => ({})), voices: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ getProviderConnections: mocks.getProviderConnections, getSettings: mocks.getSettings }));
vi.mock("open-sse/handlers/ttsProviders/localDevice.js", () => ({ fetchLocalDeviceVoices: mocks.voices }));

const { isKeylessProviderWorking, clearKeylessAvailabilityCache } = await import("../../src/sse/services/keylessAvailability.js");

const up = vi.fn(async () => new Response("", { status: 404 }));
const down = vi.fn(async () => { throw new TypeError("fetch failed"); });

beforeEach(() => {
  clearKeylessAvailabilityCache();
  vi.clearAllMocks();
  mocks.getProviderConnections.mockResolvedValue([]);
});

describe("isKeylessProviderWorking", () => {
  it("never probes keyed providers", async () => {
    expect(await isKeylessProviderWorking("openai", { fetchImpl: down })).toBe(true);
    expect(down).not.toHaveBeenCalled();
  });

  it("counts a self-hosted server only while it answers (any HTTP status)", async () => {
    expect(await isKeylessProviderWorking("coqui", { fetchImpl: up })).toBe(true);
    expect(up.mock.calls[0][0]).toBe("http://localhost:5002");
    clearKeylessAvailabilityCache();
    expect(await isKeylessProviderWorking("coqui", { fetchImpl: down })).toBe(false);
  });

  it("probes the hosts a default-route request actually calls (saved connections are not used)", async () => {
    mocks.getProviderConnections.mockResolvedValue([{ providerSpecificData: { baseUrl: "http://10.0.0.5:3002" } }]);
    await isKeylessProviderWorking("local-whisper", { fetchImpl: up });
    expect(up.mock.calls[0][0]).toBe("http://127.0.0.1:11500");

    mocks.getSettings.mockResolvedValue({ firecrawlBaseUrl: "http://192.168.1.9:3002" });
    await isKeylessProviderWorking("firecrawl_custom", { fetchImpl: up });
    expect(up.mock.calls[1][0]).toBe("http://192.168.1.9:3002");
    mocks.getSettings.mockResolvedValue({});
  });

  it("never probes a blocked cloud-metadata host", async () => {
    mocks.getSettings.mockResolvedValue({ firecrawlBaseUrl: "http://169.254.169.254" });
    expect(await isKeylessProviderWorking("firecrawl_custom", { fetchImpl: up })).toBe(false);
    expect(up).not.toHaveBeenCalled();
    mocks.getSettings.mockResolvedValue({});
  });

  it("counts keyless libraries and public services without probing", async () => {
    for (const id of ["edge-tts", "google-tts", "veoaifree-web"]) {
      expect(await isKeylessProviderWorking(id, { fetchImpl: down })).toBe(true);
    }
    expect(down).not.toHaveBeenCalled();
  });

  it("counts local-device only when the OS voice list loads", async () => {
    mocks.voices.mockResolvedValueOnce([{ id: "Samantha" }]);
    expect(await isKeylessProviderWorking("local-device")).toBe(true);
    clearKeylessAvailabilityCache();
    mocks.voices.mockRejectedValueOnce(new Error("say: not found"));
    expect(await isKeylessProviderWorking("local-device")).toBe(false);
  });

  it("caches the answer for 30 seconds", async () => {
    await isKeylessProviderWorking("tortoise", { fetchImpl: up, now: 1000 });
    await isKeylessProviderWorking("tortoise", { fetchImpl: up, now: 20_000 });
    expect(up).toHaveBeenCalledTimes(1);
    await isKeylessProviderWorking("tortoise", { fetchImpl: up, now: 40_000 });
    expect(up).toHaveBeenCalledTimes(2);
  });
});

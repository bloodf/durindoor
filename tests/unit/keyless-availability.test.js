/**
 * Media routes count a keyless provider only when it is installed and working
 * at the URL this request would call: the unscoped default, or the connection
 * a scoped API key uses. local-device needs OS voices; keyless libraries with
 * no server URL count as working.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(async () => []),
  getApiKeyProviderConnectionIds: vi.fn(async () => []),
  getSettings: vi.fn(async () => ({})),
  voices: vi.fn()
}));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getApiKeyProviderConnectionIds: mocks.getApiKeyProviderConnectionIds,
  getSettings: mocks.getSettings
}));
vi.mock("open-sse/handlers/ttsProviders/localDevice.js", () => ({ fetchLocalDeviceVoices: mocks.voices }));

const { isKeylessProviderWorking, clearKeylessAvailabilityCache } = await import("../../src/sse/services/keylessAvailability.js");

const up = vi.fn(async () => new Response("", { status: 404 }));
const down = vi.fn(async () => { throw new TypeError("fetch failed"); });

beforeEach(() => {
  clearKeylessAvailabilityCache();
  vi.clearAllMocks();
  mocks.getProviderConnections.mockResolvedValue([]);
  mocks.getApiKeyProviderConnectionIds.mockResolvedValue([]);
  mocks.getSettings.mockResolvedValue({});
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

  it("probes the saved Local Whisper host for an unscoped request, the default host when none is saved", async () => {
    mocks.getProviderConnections.mockResolvedValue([{ id: "c1", providerSpecificData: { baseUrl: "http://192.168.1.20:9000" } }]);
    await isKeylessProviderWorking("local-whisper", { fetchImpl: up });
    expect(up.mock.calls.map((c) => c[0])).toEqual(["http://192.168.1.20:9000"]);
    clearKeylessAvailabilityCache();
    up.mockClear();
    mocks.getProviderConnections.mockResolvedValue([]);
    await isKeylessProviderWorking("local-whisper", { fetchImpl: up });
    expect(up.mock.calls.map((c) => c[0])).toEqual(["http://127.0.0.1:11500"]);
  });

  it("probes the scoped key's connection host", async () => {
    mocks.getApiKeyProviderConnectionIds.mockResolvedValue(["c1"]);
    mocks.getProviderConnections.mockResolvedValue([{ id: "c1", providerSpecificData: { baseUrl: "http://192.168.1.20:9000" } }]);
    await isKeylessProviderWorking("local-whisper", { apiKeyId: "k1", fetchImpl: up });
    expect(up.mock.calls.map((c) => c[0])).toEqual(["http://192.168.1.20:9000"]);
  });

  it("probes only the first connection a scoped key may use (the one credential selection picks)", async () => {
    mocks.getApiKeyProviderConnectionIds.mockResolvedValue(["c1", "c2"]);
    mocks.getProviderConnections.mockResolvedValue([
      { id: "c1", providerSpecificData: { baseUrl: "http://10.0.0.2:11500" } },
      { id: "c2", providerSpecificData: { baseUrl: "http://10.0.0.3:11500" } }
    ]);
    const secondUp = vi.fn(async (url) => {
      if (url === "http://10.0.0.3:11500") return new Response("", { status: 404 });
      throw new TypeError("fetch failed");
    });
    expect(await isKeylessProviderWorking("local-whisper", { apiKeyId: "k1", fetchImpl: secondUp })).toBe(false);
    expect(secondUp.mock.calls.map((c) => c[0])).toEqual(["http://10.0.0.2:11500"]);
  });

  it("is not working for a scoped key with no connection of that provider", async () => {
    mocks.getApiKeyProviderConnectionIds.mockResolvedValue(["other"]);
    mocks.getProviderConnections.mockResolvedValue([{ id: "c1", providerSpecificData: {} }]);
    expect(await isKeylessProviderWorking("local-whisper", { apiKeyId: "k1", fetchImpl: up })).toBe(false);
    expect(up).not.toHaveBeenCalled();
  });

  it("probes self-hosted Firecrawl at the settings URL when unscoped", async () => {
    mocks.getSettings.mockResolvedValue({ firecrawlBaseUrl: "http://192.168.1.9:3002" });
    await isKeylessProviderWorking("firecrawl_custom", { fetchImpl: up });
    expect(up.mock.calls[0][0]).toBe("http://192.168.1.9:3002");
  });

  it("counts keyless libraries without a server URL as working", async () => {
    for (const id of ["edge-tts", "google-tts"]) {
      expect(await isKeylessProviderWorking(id, { fetchImpl: down })).toBe(true);
    }
    expect(down).not.toHaveBeenCalled();
  });

  it("probes public keyless services too", async () => {
    expect(await isKeylessProviderWorking("veoaifree-web", { fetchImpl: down })).toBe(false);
    expect(down.mock.calls[0][0]).toBe("https://veoaifree.com");
  });

  it("counts local-device only when the OS voice list loads", async () => {
    mocks.voices.mockResolvedValueOnce([{ id: "Samantha" }]);
    expect(await isKeylessProviderWorking("local-device")).toBe(true);
    clearKeylessAvailabilityCache();
    mocks.voices.mockRejectedValueOnce(new Error("say: not found"));
    expect(await isKeylessProviderWorking("local-device")).toBe(false);
  });

  it("uses the guarded fetch by default, so a metadata host is never contacted", async () => {
    mocks.getSettings.mockResolvedValue({ firecrawlBaseUrl: "http://169.254.169.254" });
    expect(await isKeylessProviderWorking("firecrawl_custom")).toBe(false);
  });

  it("caches the answer per URL for 30 seconds", async () => {
    await isKeylessProviderWorking("tortoise", { fetchImpl: up, now: 1000 });
    await isKeylessProviderWorking("tortoise", { fetchImpl: up, now: 20_000 });
    expect(up).toHaveBeenCalledTimes(1);
    await isKeylessProviderWorking("tortoise", { fetchImpl: up, now: 40_000 });
    expect(up).toHaveBeenCalledTimes(2);
  });
});

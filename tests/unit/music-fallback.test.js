import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getModelInfo: vi.fn(),
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  extractApiKey: vi.fn(),
  evaluateApiKeyAuth: vi.fn(),
  hasValidCliToken: vi.fn(),
  handleMusicGenerationCore: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
}));

vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: mocks.getModelInfo,
}));

vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  extractApiKey: mocks.extractApiKey,
  evaluateApiKeyAuth: mocks.evaluateApiKeyAuth,
  hasValidCliToken: mocks.hasValidCliToken,
}));

vi.mock("../../open-sse/handlers/musicGenerationCore.js", () => ({
  handleMusicGenerationCore: mocks.handleMusicGenerationCore,
}));

import { handleMusicGeneration } from "../../src/sse/handlers/music.js";

function makeRequest(model = "suno-override", headers = {}) {
  return new Request("http://localhost/v1/audio/music", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ model, prompt: "upbeat electronic" }),
  });
}

function successResponse() {
  return new Response(JSON.stringify({ object: "music.generation", data: [] }));
}

function makeCredentials(overrides = {}) {
  return { connectionId: "conn-1", apiKey: "ak", providerSpecificData: {}, ...overrides };
}

describe("music handler credential fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
    mocks.getModelInfo.mockResolvedValue({ provider: "suno", model: "suno-override" });
    mocks.extractApiKey.mockReturnValue(null);
    mocks.evaluateApiKeyAuth.mockResolvedValue({ ok: true, reason: null, stored: false });
    mocks.hasValidCliToken.mockResolvedValue(false);
  });

  it("passes x-connection-id to getProviderCredentials as preferred connection", async () => {
    mocks.getProviderCredentials.mockResolvedValue({ ...makeCredentials(), connectionId: "conn-pinned" });
    mocks.handleMusicGenerationCore.mockResolvedValue({ success: true, response: successResponse() });

    const req = makeRequest("suno-override", { "x-connection-id": "conn-pinned" });
    const res = await handleMusicGeneration(req);
    expect(res.status).toBe(200);
    expect(mocks.getProviderCredentials).toHaveBeenCalledWith(
      "suno",
      expect.any(Set),
      "suno-override",
      { preferredConnectionId: "conn-pinned" }
    );
  });

  it("falls back to a second credential on failure and passes excludeConnectionIds", async () => {
    const cred1 = { connectionId: "conn-1", connectionName: "first" };
    const cred2 = { connectionId: "conn-2", connectionName: "second" };
    const capturedArgs = [];
    mocks.getProviderCredentials.mockImplementation(async (provider, exclude, model) => {
      capturedArgs.push([provider, Array.from(exclude), model]);
      if (exclude.size === 0) return cred1;
      return cred2;
    });
    mocks.handleMusicGenerationCore
      .mockResolvedValueOnce({ success: false, status: 503, error: "rate limit", response: undefined })
      .mockResolvedValueOnce({ success: true, response: successResponse() });
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: true });

    const response = await handleMusicGeneration(makeRequest());
    expect(response.status).toBe(200);

    expect(mocks.getProviderCredentials).toHaveBeenCalledTimes(2);
    expect(capturedArgs).toEqual([
      ["suno", [], "suno-override"],
      ["suno", ["conn-1"], "suno-override"],
    ]);
    expect(mocks.markAccountUnavailable).toHaveBeenCalledWith("conn-1", 503, "rate limit", "suno", "suno-override");
  });

  it("returns unavailable when all credentials are rate limited", async () => {
    mocks.getProviderCredentials.mockResolvedValue({ allRateLimited: true, lastError: "Rate limited", retryAfter: 42, retryAfterHuman: "42s" });

    const response = await handleMusicGeneration(makeRequest());
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).toContain("[suno/suno-override] Rate limited");
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
  });

  it("returns the core error when the last failure is non-fallback", async () => {
    const cred1 = { connectionId: "conn-1", connectionName: "first" };
    mocks.getProviderCredentials.mockResolvedValue(cred1);
    mocks.handleMusicGenerationCore.mockResolvedValue({
      success: false,
      status: 401,
      error: "bad credentials",
      response: undefined,
    });
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false });

    const response = await handleMusicGeneration(makeRequest());
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.message).toBe("bad credentials");
  });
});

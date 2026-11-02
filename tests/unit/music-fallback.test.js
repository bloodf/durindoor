import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  getApiKeyByKey: async () => ({ id: "music-owner", isActive: true, policy: {} }),
}));

vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: mocks.getModelInfo,
}));

vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  getProviderCredentialsWithQuotaPreflight: mocks.getProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  extractApiKey: mocks.extractApiKey,
  evaluateApiKeyAuth: mocks.evaluateApiKeyAuth,
  resolveClientApiKey: async (request, options) => ({
    apiKey: mocks.extractApiKey(request),
    auth: await mocks.evaluateApiKeyAuth(mocks.extractApiKey(request), { ...options, request }),
  }),
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

function successResult() {
  return {
    success: true,
    job: { resourceId: "song-1", terminal: null },
    accounting: { state: "pending", modality: "music", tokens: {}, nativeUnits: {}, cost: null, costStatus: "unknown", costSource: "unavailable", meta: {} },
    response: new Response(JSON.stringify({ object: "music.generation", request_id: "song-1", status: "submitted", data: [{ id: "song-1", status: "submitted" }] })),
  };
}

let tempDir;
let originalDataDir;
let originalEngine;
let adapter;

afterEach(async () => {
  await adapter?.close?.();
  delete global._dbAdapter;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalEngine === undefined) delete process.env.DURINDOOR_DATABASE_ENGINE;
  else process.env.DURINDOOR_DATABASE_ENGINE = originalEngine;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

function makeCredentials(overrides = {}) {
  return { connectionId: "conn-1", apiKey: "ak", providerSpecificData: {}, ...overrides };
}

describe("music handler credential fallback", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    originalDataDir = process.env.DATA_DIR;
    originalEngine = process.env.DURINDOOR_DATABASE_ENGINE;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "music-fallback-"));
    process.env.DATA_DIR = tempDir;
    process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
    delete global._dbAdapter;
    adapter = await (await import("../../src/lib/db/driver.js")).getAdapter();
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
    mocks.getModelInfo.mockResolvedValue({ provider: "suno", model: "suno-override" });
    mocks.extractApiKey.mockReturnValue("music-owner-secret");
    mocks.evaluateApiKeyAuth.mockResolvedValue({ ok: true, reason: null, stored: true, apiKeyId: "music-owner" });
    mocks.hasValidCliToken.mockResolvedValue(false);
  });

  it("passes x-connection-id to getProviderCredentials as preferred connection", async () => {
    mocks.getProviderCredentials.mockResolvedValue({ ...makeCredentials(), connectionId: "conn-pinned" });
    mocks.handleMusicGenerationCore.mockResolvedValue(successResult());

    const req = makeRequest("suno-override", { "x-connection-id": "conn-pinned" });
    const res = await handleMusicGeneration(req);
    expect(res.status).toBe(200);
    expect(mocks.getProviderCredentials).toHaveBeenCalledWith(
      "suno",
      expect.any(Set),
      "suno-override",
      { preferredConnectionId: "conn-pinned", apiKeyId: "music-owner" }
    );
    expect(JSON.parse(adapter.get("SELECT value FROM kv WHERE scope = 'mediaJobs'").value)).toMatchObject({ apiKeyId: "music-owner", connectionId: "conn-pinned", resourceId: "song-1" });
  });

  it("falls back to a second credential on failure and passes excludeConnectionIds", async () => {
    const cred1 = { connectionId: "conn-1", connectionName: "first", apiKey: "ak" };
    const cred2 = { connectionId: "conn-2", connectionName: "second" };
    const capturedArgs = [];
    mocks.getProviderCredentials.mockImplementation(async (provider, exclude, model) => {
      capturedArgs.push([provider, Array.from(exclude), model]);
      if (exclude.size === 0) return cred1;
      return cred2;
    });
    mocks.handleMusicGenerationCore
      .mockResolvedValueOnce({ success: false, status: 503, error: "rate limit", response: undefined })
      .mockResolvedValueOnce(successResult());
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: true });

    const response = await handleMusicGeneration(makeRequest());
    expect(response.status).toBe(200);

    expect(mocks.getProviderCredentials).toHaveBeenCalledTimes(2);
    expect(capturedArgs).toEqual([
      ["suno", [], "suno-override"],
      ["suno", ["conn-1"], "suno-override"],
    ]);
    expect(mocks.markAccountUnavailable).toHaveBeenCalledWith("conn-1", 503, "rate limit", "suno", "suno-override", null, { usedCredential: "ak" });
    expect(JSON.parse(adapter.get("SELECT value FROM kv WHERE scope = 'mediaJobs'").value)).toMatchObject({ apiKeyId: "music-owner", connectionId: "conn-2", resourceId: "song-1" });
    expect(adapter.all("SELECT * FROM usageHistory")).toEqual([]);
  });

  it("returns unavailable when all credentials are rate limited", async () => {
    mocks.getProviderCredentials.mockResolvedValue({ allRateLimited: true, lastError: "Rate limited", retryAfter: 42, retryAfterHuman: "42s" });

    const response = await handleMusicGeneration(makeRequest());
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).toContain("[suno/suno-override] Rate limited");
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
  });

  it("returns 403 when the provider is disabled", async () => {
    mocks.getProviderCredentials.mockResolvedValue({ providerDisabled: true });

    const response = await handleMusicGeneration(makeRequest());
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.message).toContain("Provider 'suno' is disabled");
  });

  it("returns the core error when the last failure is non-fallback", async () => {
    const cred1 = { connectionId: "conn-1", connectionName: "first", apiKey: "ak" };
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

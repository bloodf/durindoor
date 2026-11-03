import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the DB layer before importing the handler/core under test.
const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  recordProviderConnectionFallbackState: vi.fn(),
  validateApiKey: vi.fn(),
  getSettings: vi.fn(),
  getProviderConnectionById: vi.fn(),
  getApiKeyByKey: vi.fn(),
  getApiKeyById: vi.fn(),
  getApiKeyUsageTotals: vi.fn(),
  incrementApiKeyUsageSync: vi.fn(),
  getProxyPools: vi.fn(),
  getQuotaReservationPressure: vi.fn(),
  getModelAliases: vi.fn(),
  getComboForModel: vi.fn(),
  getComboByName: vi.fn(),
  getProviderNodes: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  updateProviderConnection: mocks.updateProviderConnection,
  recordProviderConnectionFallbackState: mocks.recordProviderConnectionFallbackState,
  validateApiKey: mocks.validateApiKey,
  getSettings: mocks.getSettings,
  getApiKeyByKey: mocks.getApiKeyByKey,
  getApiKeyById: mocks.getApiKeyById,
  getProviderConnectionById: mocks.getProviderConnectionById,
  getApiKeyUsageTotals: mocks.getApiKeyUsageTotals,
  incrementApiKeyUsageSync: mocks.incrementApiKeyUsageSync,
  getProxyPools: mocks.getProxyPools,
  getQuotaReservationPressure: mocks.getQuotaReservationPressure,
  getModelAliases: mocks.getModelAliases,
  getComboForModel: mocks.getComboForModel,
  getComboByName: mocks.getComboByName,
  getProviderNodes: mocks.getProviderNodes,
  getApiKeyProviderConnectionIds: async () => [],
  saveRequestUsage: async (event) => (await import("../../src/lib/db/repos/usageRepo.js")).saveRequestUsage(event),
}));

import { handleVideoCreate, handleVideoGet } from "../../src/sse/handlers/video.js";
import { handleVideoProxyCore, getVideoConfig, sanitizeSecrets, VIDEO_ACTIONS } from "../../open-sse/handlers/videoCore.js";
import { POST, GET } from "../../src/app/api/v1/videos/[[...path]]/route.js";

const CALLER_KEY = "sk-video-owner";
let tempDir;
let originalDataDir;
let originalEngine;
let adapter;

afterEach(async () => {
  await adapter?.close?.();
  delete global._dbAdapter;
  vi.unstubAllGlobals();
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalEngine === undefined) delete process.env.DURINDOOR_DATABASE_ENGINE;
  else process.env.DURINDOOR_DATABASE_ENGINE = originalEngine;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});
const XAI_CONNECTION = {
  id: "xai-1",
  provider: "xai",
  email: "xai@example.com",
  apiKey: "xai-secret-key-1234567890",
  testStatus: "active",
};

function jsonRequest(url, body, headers = { authorization: `Bearer ${CALLER_KEY}` }) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("xAI video proxy (9router#2593)", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    originalDataDir = process.env.DATA_DIR;
    originalEngine = process.env.DURINDOOR_DATABASE_ENGINE;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xai-video-proxy-"));
    process.env.DATA_DIR = tempDir;
    process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
    delete global._dbAdapter;
    adapter = await (await import("../../src/lib/db/driver.js")).getAdapter();
    adapter.run("INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, createdAt) VALUES(?, ?, ?, 1, '[]', ?)", ["video-owner", CALLER_KEY, "Video test", new Date().toISOString()]);
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
    mocks.getProviderConnections.mockResolvedValue([{ ...XAI_CONNECTION }]);
    mocks.getProviderConnectionById.mockImplementation(async (id) => {
      if (id === XAI_CONNECTION.id) return { ...XAI_CONNECTION };
      return id === "minimax-1" ? {
        id,
        provider: "minimax",
        apiKey: "minimax-secret",
        testStatus: "active",
      } : null;
    });
    mocks.getApiKeyByKey.mockImplementation(async (key) => key === CALLER_KEY ? { id: "video-owner", isActive: true, policy: {} } : null);
    mocks.getApiKeyUsageTotals.mockResolvedValue({});
    mocks.getProxyPools.mockResolvedValue([]);
    mocks.getQuotaReservationPressure.mockResolvedValue({});
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getComboByName.mockResolvedValue(null);
    mocks.getProviderNodes.mockResolvedValue([]);
    vi.unstubAllGlobals();
  });

  it("exposes xai videoConfig from the registry", () => {
    expect(getVideoConfig("xai")).toEqual({ baseUrl: "https://api.x.ai/v1/videos" });
    expect(VIDEO_ACTIONS.has("generations")).toBe(true);
  });

  it("POST generations forwards exact body + bearer and passes upstream status/body through", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ request_id: "vid-123", status: "pending" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const req = jsonRequest("http://localhost/v1/videos/generations", {
      model: "xai/grok-imagine-video",
      prompt: "a cat on the moon",
      duration: 6,
    });
    const res = await handleVideoCreate(req, "generations");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ request_id: "vid-123", status: "pending" });

    const [url, init] = fetchMock.mock.calls[0];
    // Provider prefix stripped before forwarding; body otherwise untouched.
    expect(url).toBe("https://api.x.ai/v1/videos/generations");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Bearer ${XAI_CONNECTION.apiKey}`);
    expect(JSON.parse(init.body)).toEqual({ model: "grok-imagine-video", prompt: "a cat on the moon", duration: 6 });
    // Account-pinning header returned for later polls.
    expect(res.headers.get("x-9router-connection-id")).toBe("xai-1");
    expect(res.headers.get("access-control-expose-headers")).toContain("x-9router-connection-id");
    expect(JSON.parse(adapter.get("SELECT value FROM kv WHERE scope = 'mediaJobs'").value)).toMatchObject({ apiKeyId: "video-owner", connectionId: "xai-1", resourceId: "vid-123", model: "grok-imagine-video" });
    expect(adapter.all("SELECT * FROM usageHistory")).toEqual([]);
  });

  it("GET polls https://api.x.ai/v1/videos/{id} with auth", async () => {
    // Polling headers select an account; only a persisted caller-owned job authorizes access.
    const { createMediaJob } = await import("../../src/lib/db/repos/mediaJobsRepo.js");
    await createMediaJob({ provider: "xai", model: "grok-imagine-video", connectionId: "xai-1", resourceId: "vid-123", apiKeyId: "video-owner", usageEventId: "video-poll-test", endpoint: "/v1/videos/generations" });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "done", video: { url: "https://x.ai/v.mp4" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request("http://localhost/v1/videos/vid-123", {
      headers: { "x-connection-id": "xai-1", authorization: `Bearer ${CALLER_KEY}` },
    });
    const res = await handleVideoGet(req, "vid-123");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "done", video: { url: "https://x.ai/v.mp4" } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.x.ai/v1/videos/vid-123");
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe(`Bearer ${XAI_CONNECTION.apiKey}`);
    expect(res.headers.get("access-control-expose-headers")).toContain("x-9router-connection-id");
    expect(adapter.all("SELECT usageEventId, connectionId FROM usageHistory")).toEqual([{ usageEventId: "video-poll-test", connectionId: "xai-1" }]);
  });

  it("polls MiniMax with the account header returned by MiniMax creation", async () => {
    const minimaxConnection = { id: "minimax-1", provider: "minimax", apiKey: "minimax-secret", testStatus: "active" };
    mocks.getProviderConnections.mockResolvedValue([minimaxConnection]);
    const fetchMock = vi.fn(async (url) => String(url).includes("/v2/query/video_generation/")
      ? new Response(JSON.stringify({
        task: { id: "task-mm", status: "succeeded", content: { url: "https://minimax.example/video.mp4" } },
      }), { status: 200, headers: { "content-type": "application/json" } })
      : String(url).endsWith("/v2/video_generation")
        ? new Response(JSON.stringify({ task_id: "task-mm" }), { status: 200, headers: { "content-type": "application/json" } })
        : new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const create = await handleVideoCreate(jsonRequest("http://localhost/v1/videos/generations", {
      model: "minimax/MiniMax-H3", prompt: "A lantern over a lake", resolution: "2K", duration: 5, aspect_ratio: "16:9",
    }), "generations");
    const returnedHeader = create.headers.get("x-9router-connection-id");
    expect(returnedHeader).toBe("minimax-1");

    const res = await handleVideoGet(new Request("http://localhost/v1/videos/task-mm", {
      headers: { "x-connection-id": returnedHeader, authorization: `Bearer ${CALLER_KEY}` },
    }), "task-mm");
    const pollCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/v2/query/video_generation/"));

    expect(res.status).toBe(200);
    expect(pollCall[0]).toBe("https://api.minimax.io/v2/query/video_generation/task-mm");
    expect(await res.json()).toEqual({ request_id: "task-mm", status: "done", video: { url: "https://minimax.example/video.mp4" } });
  });

  it("returns 401 when API key required but missing", async () => {
    mocks.getSettings.mockResolvedValue({ requireApiKey: true });
    const req = jsonRequest("http://localhost/v1/videos/generations", { prompt: "x" }, {});
    const res = await handleVideoCreate(req, "generations");
    expect(res.status).toBe(401);
    expect((await res.json()).error.message).toBe("Missing API key");
  });

  it("returns 401 when API key invalid", async () => {
    mocks.getSettings.mockResolvedValue({ requireApiKey: true });
    mocks.validateApiKey.mockResolvedValue(false);
    const req = jsonRequest(
      "http://localhost/v1/videos/generations",
      { prompt: "x" },
      { authorization: "Bearer wrong-key" },
    );
    const res = await handleVideoCreate(req, "generations");
    expect(res.status).toBe(401);
    expect((await res.json()).error.message).toBe("Invalid API key");
  });

  it("returns 400 on malformed JSON body", async () => {
    const req = jsonRequest("http://localhost/v1/videos/generations", "{not json");
    const res = await handleVideoCreate(req, "generations");
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe("Invalid JSON body");
  });

  it("returns 400 for unknown action without touching connection state", async () => {
    const req = jsonRequest("http://localhost/v1/videos/dance", { prompt: "x" });
    const res = await handleVideoCreate(req, "dance");
    expect(res.status).toBe(400);
    expect(mocks.recordProviderConnectionFallbackState).not.toHaveBeenCalled();
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("sanitizes bearer tokens and credential secrets from upstream error text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(`Unauthorized: Bearer ${XAI_CONNECTION.apiKey} rejected`, { status: 401 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await handleVideoProxyCore({
      provider: "xai",
      action: "generations",
      rawBody: "{}",
      contentType: "application/json",
      credentials: { apiKey: XAI_CONNECTION.apiKey },
    });

    expect(result.success).toBeFalsy();
    expect(result.status).toBe(401);
    expect(result.error).not.toContain(XAI_CONNECTION.apiKey);
    expect(result.error).toContain("[redacted]");
  });

  it("route dispatches POST generations and rejects extra path segments", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ request_id: "vid-9", status: "pending" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    // No-model routing is covered in media-routes-handlers.test.js.
    const okReq = jsonRequest("http://localhost/v1/videos/generations", { model: "xai/grok-imagine-video", prompt: "hi" });
    const okRes = await POST(okReq, { params: Promise.resolve({ path: ["generations"] }) });
    expect(okRes.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.x.ai/v1/videos/generations");

    const badReq = jsonRequest("http://localhost/v1/videos/generations/extra", { prompt: "hi" });
    const badRes = await POST(badReq, { params: Promise.resolve({ path: ["generations", "extra"] }) });
    expect(badRes.status).toBe(400);

    const badGet = await GET(new Request("http://localhost/v1/videos/"), { params: Promise.resolve({ path: [] }) });
    expect(badGet.status).toBe(400);
  });

  it("sanitizeSecrets redacts accessToken/refreshToken/apiKey fields", () => {
    const out = sanitizeSecrets("tok=abc123456789 and Bearer def456789012", {
      accessToken: "abc123456789",
      refreshToken: "short",
    });
    expect(out).not.toContain("abc123456789");
    expect(out).toContain("[redacted]");
    // Short secrets (<8 chars) are left alone (low collision risk) — the
    // input never contained the 5-char refreshToken, so nothing to redact.
    expect(out).toBe("tok=[redacted] and Bearer [redacted]");
  });
});

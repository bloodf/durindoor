import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("open-sse/services/tokenRefresh.js", () => ({ refreshTokenByProvider: vi.fn() }));

import { getVideoConfig, handleVideoProxyCore } from "open-sse/handlers/videoCore.js";
import { PROVIDER_MEDIA, PROVIDER_MODELS } from "open-sse/providers/index.js";

const originalFetch = global.fetch;
const jsonResponse = (body) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { "Content-Type": "application/json" },
});

describe("MiniMax video generation (#3258)", () => {
  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => { global.fetch = originalFetch; });

  it("registers MiniMax-H3 as video for both regional providers", () => {
    for (const provider of ["minimax", "minimax-cn"]) {
      expect(PROVIDER_MEDIA[provider].serviceKinds).toContain("video");
      expect(PROVIDER_MODELS[provider]).toContainEqual(expect.objectContaining({ id: "MiniMax-H3", kind: "video" }));
      expect(getVideoConfig(provider).defaultModel).toBe("MiniMax-H3");
    }
  });

  it("maps an OpenAI-style creation request and response to MiniMax v2", async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ task_id: "task-123" }));

    const result = await handleVideoProxyCore({
      provider: "minimax",
      action: "generations",
      rawBody: JSON.stringify({
        model: "MiniMax-H3",
        prompt: "A lantern over a lake",
        resolution: "2K",
        duration: 5,
        aspect_ratio: "16:9",
      }),
      contentType: "application/json",
      credentials: { apiKey: "test-key" },
    });

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe("https://api.minimax.io/v2/video_generation");
    expect(JSON.parse(init.body)).toEqual({
      model: "MiniMax-H3",
      content: [{ type: "text", text: "A lantern over a lake" }],
      resolution: "2K",
      duration: 5,
      ratio: "16:9",
    });
    expect(await result.response.json()).toEqual({ request_id: "task-123" });
  });

  it("preserves native multimodal content and enforces H3-Max limits", async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ task_id: "task-456" }));
    const result = await handleVideoProxyCore({
      provider: "minimax",
      action: "generations",
      rawBody: JSON.stringify({
        model: "MiniMax-H3-Max",
        content: [{ type: "text", text: "Animate this portrait" }, { type: "image_url", image_url: "https://cdn.example/reference.png" }],
        resolution: "768P",
        duration: 5,
        aspect_ratio: "16:9",
      }),
      contentType: "application/json",
      credentials: { apiKey: "test-key" },
    });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).content).toEqual([
      { type: "text", text: "Animate this portrait" },
      { type: "image_url", image_url: "https://cdn.example/reference.png" },
    ]);
    expect(await result.response.json()).toEqual({ request_id: "task-456" });

    const invalid = await handleVideoProxyCore({
      provider: "minimax",
      action: "generations",
      rawBody: JSON.stringify({ model: "MiniMax-H3-Max", prompt: "No 2K", resolution: "2K", duration: 5, aspect_ratio: "16:9" }),
      contentType: "application/json",
      credentials: { apiKey: "test-key" },
    });
    expect(invalid.status).toBe(400);
  });

  it("rejects non-object MiniMax request JSON", async () => {
    const result = await handleVideoProxyCore({
      provider: "minimax",
      action: "generations",
      rawBody: "null",
      contentType: "application/json",
      credentials: { apiKey: "test-key" },
    });
    expect(result.status).toBe(400);
  });

  it("routes legacy Hailuo creation and facade polling to v1", async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ task_id: "legacy-task" }))
      .mockResolvedValueOnce(jsonResponse({ task_id: "legacy-task", status: "Processing" }));
    const created = await handleVideoProxyCore({
      provider: "minimax",
      action: "generations",
      rawBody: JSON.stringify({ model: "MiniMax-Hailuo-2.3", prompt: "A sailboat", duration: 6, resolution: "768P" }),
      contentType: "application/json",
      credentials: { apiKey: "test-key" },
    });
    expect(global.fetch.mock.calls[0][0]).toBe("https://api.minimax.io/v1/video_generation");
    expect(await created.response.json()).toEqual({ request_id: "minimax-v1:legacy-task" });

    const polled = await handleVideoProxyCore({ provider: "minimax", requestId: "minimax-v1:legacy-task", credentials: { apiKey: "test-key" } });
    expect(global.fetch.mock.calls[1][0]).toBe("https://api.minimax.io/v1/query/video_generation?task_id=legacy-task");
    expect(await polled.response.json()).toEqual({ request_id: "minimax-v1:legacy-task", status: "processing" });
  });

  it("normalizes MiniMax polling status and video metadata", async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({
      task: {
        id: "task-123",
        status: "succeeded",
        duration: 5,
        resolution: "2K",
        ratio: "16:9",
        content: { url: "https://cdn.example/video.mp4" },
      },
    }));

    const result = await handleVideoProxyCore({
      provider: "minimax",
      requestId: "task-123",
      credentials: { apiKey: "test-key" },
    });

    expect(global.fetch.mock.calls[0][0]).toBe("https://api.minimax.io/v2/query/video_generation/task-123");
    expect(await result.response.json()).toEqual({
      request_id: "task-123",
      status: "done",
      video: {
        url: "https://cdn.example/video.mp4",
        duration: 5,
        resolution: "2K",
        aspect_ratio: "16:9",
      },
    });
  });
});

describe("Together video generation", () => {
  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => { global.fetch = originalFetch; });

  it("forwards documented Together create and retrieve jobs", async () => {
    const body = JSON.stringify({ model: "minimax/video-01-director", prompt: "A lantern" });
    global.fetch.mockResolvedValueOnce(jsonResponse({ id: "video-123", object: "video", model: "minimax/video-01-director", status: "in_progress", size: "720p", seconds: "5", created_at: 1 }));
    const created = await handleVideoProxyCore({ provider: "together", action: "generations", rawBody: body, contentType: "application/json", credentials: { apiKey: "test-key" } });
    expect(created.success).toBe(true);
    expect(global.fetch.mock.calls[0][0]).toBe("https://api.together.ai/v2/videos");
    expect(global.fetch.mock.calls[0][1].body).toBe(body);

    global.fetch.mockResolvedValueOnce(jsonResponse({ id: "video-123", object: "video", model: "minimax/video-01-director", status: "completed", size: "720p", seconds: "5", created_at: 1, outputs: { cost: 1, video_url: "https://cdn.example/video.mp4" } }));
    const retrieved = await handleVideoProxyCore({ provider: "together", requestId: "video-123", credentials: { apiKey: "test-key" } });
    expect(retrieved.success).toBe(true);
    expect(global.fetch.mock.calls[1][0]).toBe("https://api.together.ai/v2/videos/video-123");
    expect(await retrieved.response.json()).toEqual(expect.objectContaining({ id: "video-123", outputs: { cost: 1, video_url: "https://cdn.example/video.mp4" } }));
  });

  it("rejects unsupported Together video actions", async () => {
    const result = await handleVideoProxyCore({ provider: "together", action: "edits", rawBody: "{}", contentType: "application/json", credentials: { apiKey: "test-key" } });
    expect(result.success).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

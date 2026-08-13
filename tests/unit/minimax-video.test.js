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

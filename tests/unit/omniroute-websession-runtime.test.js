import { describe, expect, it, vi, afterEach } from "vitest";
import { parseJsonlLine, readJsonlResponse } from "open-sse/executors/huggingchat/jsonlStream.js";
import { buildYuanbaoCookie } from "open-sse/executors/yuanbao-web.js";
import { detectIntent } from "open-sse/executors/veoaifree-web.js";
import { parseMetaAiResponseText } from "open-sse/executors/muse-spark-web/response-parser.js";
import { handleMusicGenerationCore } from "open-sse/handlers/musicGenerationCore.js";
import { handleVideoGenerationCore } from "open-sse/handlers/videoGenerationCore.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ported OmniRoute web/session runtime helpers", () => {
  it("parses HuggingChat JSONL tokens and final answers", async () => {
    expect(parseJsonlLine(JSON.stringify({ type: "stream", token: "hi\0\0" }))).toEqual({ token: "hi" });
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ type: "stream", token: "hel" })}\n${JSON.stringify({ type: "finalAnswer", text: "hello" })}\n`));
        controller.close();
      },
    });
    await expect(readJsonlResponse(stream)).resolves.toMatchObject({ text: "hello" });
  });

  it("normalizes Yuanbao cookies to the hy_source web session shape", () => {
    expect(buildYuanbaoCookie("Cookie: hy_user=u1; other=x; hy_token=t1")).toEqual({
      cookie: "hy_source=web; hy_user=u1; hy_token=t1",
      hasToken: true,
    });
  });

  it("detects VeoAIFree media intent from model and prompt", () => {
    expect(detectIntent("veo", "a cat cinematic")).toBe("video");
    expect(detectIntent("banana-image", "draw a cat")).toBe("image");
    expect(detectIntent("speech", "read this")).toBe("tts");
  });

  it("extracts Muse Spark assistant content from Meta AI SSE payloads", () => {
    const payload = {
      data: {
        sendMessageStream: {
          __typename: "AssistantMessage",
          contentRenderer: { text: "hello from meta" },
        },
      },
    };
    const parsed = parseMetaAiResponseText(`data: ${JSON.stringify(payload)}\n\n`, false);
    expect(parsed).toMatchObject({ status: 200, content: "hello from meta" });
  });
});

describe("ported media route cores", () => {
  it("posts Suno music generation with a cookie session", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      expect(init.headers.Cookie).toBe("sid=suno");
      expect(JSON.parse(init.body)).toMatchObject({ prompt: "lofi", model: "chirp-v4" });
      return new Response(JSON.stringify({ clips: [{ id: "c1", audio_url: "https://cdn.test/song.mp3" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    const result = await handleMusicGenerationCore({
      provider: "suno",
      model: "chirp-v4",
      body: { prompt: "lofi" },
      credentials: { apiKey: "sid=suno" },
    });
    expect(result.success).toBe(true);
    await expect(result.response.json()).resolves.toMatchObject({
      object: "music.generation",
      data: [expect.objectContaining({ audio_url: "https://cdn.test/song.mp3" })],
    });
  });

  it("routes VeoAIFree video generation through the concrete executor", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
      if (String(url) === "https://veoaifree.com") {
        return new Response('nonce":"abc123"', { status: 200 });
      }
      if (String(url).includes("admin-ajax.php") && String(init.body).includes("full-video-generate")) {
        return new Response("scene-data", { status: 200 });
      }
      return new Response("https://cdn.test/video.mp4", { status: 200 });
    }));
    vi.useFakeTimers();
    const promise = handleVideoGenerationCore({
      provider: "veoaifree-web",
      model: "veo",
      body: { prompt: "cinematic test" },
      credentials: { apiKey: "public" },
    });
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await promise;
    vi.useRealTimers();
    expect(result.success).toBe(true);
    await expect(result.response.json()).resolves.toMatchObject({
      object: "video.generation",
      data: [expect.objectContaining({ url: "https://cdn.test/video.mp4" })],
    });
  });
});

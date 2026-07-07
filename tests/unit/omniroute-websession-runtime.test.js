import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchWithTimeout } from "open-sse/executors/websession-utils.js";
import { parseJsonlLine, readJsonlResponse } from "open-sse/executors/huggingchat/jsonlStream.js";
import { buildYuanbaoCookie, YuanbaoWebExecutor } from "open-sse/executors/yuanbao-web.js";
import { detectIntent } from "open-sse/executors/veoaifree-web.js";
import { parseMetaAiResponseText } from "open-sse/executors/muse-spark-web/response-parser.js";
import { handleMusicGenerationCore } from "open-sse/handlers/musicGenerationCore.js";
import { handleVideoGenerationCore } from "open-sse/handlers/videoGenerationCore.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("ported OmniRoute web/session runtime helpers", () => {
  it("fetchWithTimeout covers only request setup, not the returned stream body", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchSpy = vi.fn(async (_url, init) => {
      expect(init.signal).toBeDefined();
      return new Response(
        new ReadableStream({
          start(ctrl) {
            setTimeout(() => ctrl.enqueue(new TextEncoder().encode("late-chunk")), 40_000);
            setTimeout(() => ctrl.close(), 40_001);
          },
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", fetchSpy);

    const response = await fetchWithTimeout("http://test/sse", { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(35_000);
    expect(controller.signal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(10_000);
    const reader = response.body.getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toBe("late-chunk");
  });

  it("Yuanbao streaming chat can still emit after the old 30s web-session timeout", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchSpy = vi.fn(async (url, init) => {
      if (String(url).includes("/agent/conversation/create")) {
        return new Response(JSON.stringify({ id: "conv1" }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(
        new ReadableStream({
          start(ctrl) {
            setTimeout(() => {
              ctrl.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: "text", msg: "hello" })}\n\n`));
            }, 40_000);
            setTimeout(() => ctrl.close(), 40_001);
          },
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", fetchSpy);

    const executor = new YuanbaoWebExecutor();
    const result = await executor.execute({
      model: "deepseek-v3",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials: { apiKey: "hy_user=u; hy_token=t" },
      signal: controller.signal,
    });

    const chatCalls = fetchSpy.mock.calls.filter(([url]) => String(url).includes("/chat/conv1"));
    expect(chatCalls.length).toBe(1);
    const chatSignal = chatCalls[0][1]?.signal;
    expect(chatSignal).toBeDefined();

    await vi.advanceTimersByTimeAsync(35_000);
    expect(controller.signal.aborted).toBe(false);
    expect(chatSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(10_000);
    const text = await result.response.text();
    expect(text).toContain("hello");
  });

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
    expect(result.success).toBe(true);
    await expect(result.response.json()).resolves.toMatchObject({
      object: "video.generation",
      data: [expect.objectContaining({ url: "https://cdn.test/video.mp4" })],
    });
  });
});

import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchWithTimeout, mergeAbortSignals, withTimeoutSignal } from "open-sse/executors/websession-utils.js";
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

function trackAbortListeners(signal) {
  const add = vi.spyOn(signal, "addEventListener");
  const remove = vi.spyOn(signal, "removeEventListener");
  return () => {
    expect(add.mock.calls.length).toBeGreaterThan(0);
    expect(remove).toHaveBeenCalledTimes(add.mock.calls.length);
  };
}

describe("ported OmniRoute web/session runtime helpers", () => {
  it("fetchWithTimeout covers only request setup, not the returned stream body", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const assertClean = trackAbortListeners(controller.signal);
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
    const { done } = await reader.read();
    expect(done).toBe(true);
    assertClean();
  });

  it("removes abort listeners across success, rejection, timeout, and caller abort on a shared long-lived signal", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const assertClean = trackAbortListeners(controller.signal);
    const success = new Response("ok");
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(success)
      .mockRejectedValueOnce(new Error("network failure"))
      .mockImplementation((_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      }));
    vi.stubGlobal("fetch", fetchSpy);

    const successfulResponse = await fetchWithTimeout("http://test/success", { signal: controller.signal });
    await successfulResponse.text();
    assertClean();

    await expect(fetchWithTimeout("http://test/failure", { signal: controller.signal })).rejects.toThrow("network failure");
    assertClean();

    const timeout = fetchWithTimeout("http://test/timeout", { signal: controller.signal }, { timeoutMs: 1 });
    const expectTimeout = expect(timeout).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(1);
    await expectTimeout;
    assertClean();

    const cancelled = fetchWithTimeout("http://test/cancel", { signal: controller.signal });
    controller.abort("caller cancelled");
    await expect(cancelled).rejects.toBe("caller cancelled");
    assertClean();
  });

  it("cleans fallback merged listeners with one named handler per input while preserving caller abort reason", () => {
    const caller = new AbortController();
    const timeout = new AbortController();
    const originalDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, "any");
    const assertCaller = trackAbortListeners(caller.signal);
    const assertTimeout = trackAbortListeners(timeout.signal);
    Object.defineProperty(AbortSignal, "any", { configurable: true, writable: true, value: undefined });
    try {
      const merged = mergeAbortSignals(caller.signal, timeout.signal);
      const reason = new Error("caller reason");
      caller.abort(reason);
      expect(merged.reason).toBe(reason);
      assertCaller();
      assertTimeout();
    } finally {
      Object.defineProperty(AbortSignal, "any", originalDescriptor);
    }
  });

  it("preserves timeout DOMException reason in the merged fallback when the timeout input aborts", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, "any");
    const caller = new AbortController();
    const assertCaller = trackAbortListeners(caller.signal);
    Object.defineProperty(AbortSignal, "any", { configurable: true, writable: true, value: undefined });
    try {
      const merged = withTimeoutSignal(caller.signal, 1);
      await new Promise((resolve) => merged.addEventListener("abort", resolve, { once: true }));
      expect(merged.aborted).toBe(true);
      expect(merged.reason).toBeInstanceOf(DOMException);
      expect(merged.reason.name).toBe("TimeoutError");
      assertCaller();
    } finally {
      Object.defineProperty(AbortSignal, "any", originalDescriptor);
    }
  });

  it("cleans a live second input's listener when the first input is already aborted", () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, "any");
    const alreadyAborted = new AbortController();
    const live = new AbortController();
    const reason = new Error("first already aborted");
    alreadyAborted.abort(reason);
    const assertLive = trackAbortListeners(live.signal);
    Object.defineProperty(AbortSignal, "any", { configurable: true, writable: true, value: undefined });
    try {
      const merged = mergeAbortSignals(live.signal, alreadyAborted.signal);
      expect(merged.reason).toBe(reason);
      assertLive();
    } finally {
      Object.defineProperty(AbortSignal, "any", originalDescriptor);
    }
  });

  it("removes caller abort listener once the streamed response body completes naturally", async () => {
    const controller = new AbortController();
    const assertClean = trackAbortListeners(controller.signal);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("streamed payload", { status: 201, headers: { "X-Trace": "abc" } })));
    const response = await fetchWithTimeout("http://test/stream", { signal: controller.signal });
    expect(response.status).toBe(201);
    expect(response.headers.get("X-Trace")).toBe("abc");
    expect(await response.text()).toBe("streamed payload");
    assertClean();
  });

  it("removes caller abort listener when response.json() drains the body", async () => {
    const controller = new AbortController();
    const assertClean = trackAbortListeners(controller.signal);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const response = await fetchWithTimeout("http://test/json", { signal: controller.signal });
    expect(await response.json()).toEqual({ ok: true });
    assertClean();
  });

  it("removes caller abort listener when the response body is cancelled without reading", async () => {
    const controller = new AbortController();
    const assertClean = trackAbortListeners(controller.signal);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      new ReadableStream({ start(ctrl) { ctrl.enqueue(new TextEncoder().encode("chunk-1")); } }),
      { status: 200 }
    )));
    const response = await fetchWithTimeout("http://test/cancel-body", { signal: controller.signal });
    await response.body.cancel();
    assertClean();
  });

  it("removes caller abort listener when caller aborts mid-stream, rejecting the pending read with the same reason", async () => {
    const controller = new AbortController();
    const assertClean = trackAbortListeners(controller.signal);
    let pull;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      new ReadableStream({
        start(ctrl) { ctrl.enqueue(new TextEncoder().encode("chunk-1")); },
        pull() { pull ??= new Promise(() => {}); return pull; },
      }),
      { status: 200 }
    )));
    const response = await fetchWithTimeout("http://test/midstream", { signal: controller.signal });
    const reader = response.body.getReader();
    await reader.read();
    const pendingRead = reader.read();
    const reason = new Error("caller done");
    controller.abort(reason);
    await expect(pendingRead).rejects.toBe(reason);
    assertClean();
  });

  it("removes caller abort listener when upstream response has no body", async () => {
    const controller = new AbortController();
    const assertClean = trackAbortListeners(controller.signal);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    const response = await fetchWithTimeout("http://test/no-body", { signal: controller.signal });
    expect(response.status).toBe(204);
    assertClean();
  });

  it("removes caller abort listener when upstream body errors", async () => {
    const controller = new AbortController();
    const assertClean = trackAbortListeners(controller.signal);
    const error = new Error("upstream body failure");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      new ReadableStream({ start(stream) { stream.error(error); } }),
      { status: 200 }
    )));
    const response = await fetchWithTimeout("http://test/body-error", { signal: controller.signal });
    await expect(response.text()).rejects.toBe(error);
    assertClean();
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

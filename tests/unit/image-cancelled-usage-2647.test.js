// #2647: a client cancel after the provider's 2xx headers but before its body is
// read must keep what is known and never invent usage. Every upstream here is a
// local stub; no provider or paid API is called.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({ noAuth: true })),
}));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetch(...args),
}));

const { handleImageGenerationCore } = await import("../../open-sse/handlers/imageGenerationCore.js");
const { handleImageEditCore } = await import("../../open-sse/handlers/imageEditCore.js");

const credentials = { apiKey: "fixture", accessToken: "fixture" };
const sse = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

/**
 * A 2xx upstream whose body sends `chunks` and then stalls, erroring like
 * fetch does when its signal aborts. Resolves `headersSent` once dispatched.
 */
function stalledUpstream(chunks = [], init = {}) {
  let headersSent;
  const sent = new Promise((resolve) => { headersSent = resolve; });
  const fetchMock = vi.fn(async (_url, { signal }) => {
    const body = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        signal.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")), { once: true });
      },
    });
    headersSent();
    return new Response(body, { status: 200, headers: { "content-type": "application/json" }, ...init });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, sent };
}

const UNKNOWN_CANCELLED = {
  state: "cancelled", modality: "image", tokens: {}, nativeUnits: {},
  cost: null, costStatus: "unknown", costSource: "client-cancelled",
  meta: { clientCancelled: "after-upstream-headers" },
};

afterEach(() => vi.unstubAllGlobals());

describe("image generation core: cancel after upstream 2xx (#2647)", () => {
  it("returns 499 with unknown-cost cancelled evidence when a synchronous body is cancelled", async () => {
    const { sent } = stalledUpstream(['{"created":1,"data":[{"b64_json":"aGk="}],"usa']);
    const controller = new AbortController();
    const onRequestSuccess = vi.fn();
    const pending = handleImageGenerationCore({
      body: { prompt: "a fox" }, modelInfo: { provider: "openai", model: "gpt-image-1" },
      credentials, signal: controller.signal, onRequestSuccess,
    });
    await sent;
    controller.abort();
    const result = await pending;

    expect(result.success).toBe(false);
    expect(result.status).toBe(499);
    expect(result.cancelledUsage).toEqual(UNKNOWN_CANCELLED);
    expect(result.acceptedJob).toBeUndefined();
    // Account health is untouched: a cancel is not provider success or failure.
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });

  it("carries no evidence when the client cancels before the provider answers", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    })));
    const controller = new AbortController();
    const pending = handleImageGenerationCore({
      body: { prompt: "a fox" }, modelInfo: { provider: "openai", model: "gpt-image-1" },
      credentials, signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();
    const result = await pending;
    expect(result.status).toBe(499);
    expect(result.cancelledUsage).toBeUndefined();
  });

  it("keeps a usage receipt already read, but counts no image that was not completed", async () => {
    const usage = { input_tokens: 9, output_tokens: 4, total_tokens: 13 };
    const { sent } = stalledUpstream([
      sse("response.in_progress", { response: { status: "in_progress", usage } }),
      sse("response.output_item.done", { item: { type: "image_generation_call", result: "aGk=" } }),
    ], { headers: { "content-type": "text/event-stream" } });
    const controller = new AbortController();
    const pending = handleImageGenerationCore({
      body: { prompt: "a fox" }, modelInfo: { provider: "codex", model: "gpt-5.4-image" },
      credentials, signal: controller.signal,
    });
    await sent;
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    const result = await pending;

    expect(result.status).toBe(499);
    expect(result.cancelledUsage).toMatchObject({
      state: "cancelled", tokens: usage, nativeUnits: {}, cost: null, costStatus: "unknown", costSource: "client-cancelled",
      meta: { clientCancelled: "after-upstream-headers", providerUsage: { path: "response.usage", value: usage } },
    });
  });

  // A stream's 2xx only proves the work started: without a receipt nothing is
  // known, so nothing is recorded, as before. A receipt read before the cancel is kept.
  async function streamThenCancel(chunks) {
    stalledUpstream(chunks, { headers: { "content-type": "text/event-stream" } });
    const outcomes = [];
    const result = await handleImageGenerationCore({
      body: { prompt: "a fox" }, modelInfo: { provider: "codex", model: "gpt-5.4-image" },
      credentials, streamToClient: true, signal: new AbortController().signal,
      onStreamComplete: async (outcome) => outcomes.push(outcome),
    });
    expect(result.success).toBe(true);
    const reader = result.response.body.getReader();
    await reader.read();
    await reader.cancel("client left");
    await result.completion;
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe("abort");
    return outcomes[0];
  }

  it("reports no evidence for a stream the client cancels before any receipt", async () => {
    const outcome = await streamThenCancel([sse("response.created", { response: { status: "in_progress" } })]);
    expect(outcome.cancelledUsage).toBeUndefined();
  });

  it("keeps a receipt read from a stream before the client cancels", async () => {
    const usage = { input_tokens: 9, output_tokens: 4, total_tokens: 13 };
    const outcome = await streamThenCancel([sse("response.in_progress", { response: { status: "in_progress", usage } })]);
    expect(outcome.cancelledUsage).toMatchObject({ ...UNKNOWN_CANCELLED, tokens: usage, meta: { clientCancelled: "after-upstream-headers" } });
  });

  it("reports no evidence for a buffered read of a stream cancelled before any receipt", async () => {
    const { sent } = stalledUpstream([sse("response.created", { response: { status: "in_progress" } })], { headers: { "content-type": "text/event-stream" } });
    const controller = new AbortController();
    const pending = handleImageGenerationCore({
      body: { prompt: "a fox" }, modelInfo: { provider: "codex", model: "gpt-5.4-image" },
      credentials, signal: controller.signal,
    });
    await sent;
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    const result = await pending;
    expect(result.status).toBe(499);
    expect(result.cancelledUsage).toBeUndefined();
  });
});

describe("image edit core: cancel after upstream 2xx (#2647)", () => {
  const edit = (signal) => {
    const formData = new FormData();
    formData.set("prompt", "make it blue");
    formData.set("image", new Blob(["img"], { type: "image/png" }), "a.png");
    return handleImageEditCore({ formData, modelInfo: { provider: "openai", model: "gpt-image-1" }, credentials, signal });
  };

  it("returns 499 with unknown-cost cancelled evidence instead of throwing", async () => {
    const { sent } = stalledUpstream(['{"data":[{"b64_json":"aGk="}]']);
    const controller = new AbortController();
    const pending = edit(controller.signal);
    await sent;
    controller.abort();
    const result = await pending;

    expect(result.success).toBe(false);
    expect(result.status).toBe(499);
    expect(result.cancelledUsage).toEqual(UNKNOWN_CANCELLED);
  });

  it("still propagates a body read failure that is not a client cancel", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({
      start(controller) { controller.error(new Error("socket reset")); },
    }))));
    await expect(edit(new AbortController().signal)).rejects.toThrow("socket reset");
  });
});

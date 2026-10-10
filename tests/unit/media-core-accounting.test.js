import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({ noAuth: true })),
}));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetch(...args),
}));

import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";
import { handleImageEditCore } from "../../open-sse/handlers/imageEditCore.js";
import { handleEmbeddingsCore } from "../../open-sse/handlers/embeddingsCore.js";

const credentials = { apiKey: "fixture" };
const json = (value) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
const image = (provider, extra = {}) => handleImageGenerationCore({
  body: { prompt: "fixture", n: 9 }, modelInfo: { provider, model: "fixture" }, credentials, ...extra,
});

afterEach(() => vi.unstubAllGlobals());

describe("internal media core accounting", () => {
  it("retains Gemini usage before image normalization and binary conversion", async () => {
    const usageMetadata = { promptTokenCount: 11, candidatesTokenCount: 7, totalTokenCount: 18 };
    vi.stubGlobal("fetch", vi.fn(async () => json({
      usageMetadata, candidates: [{ content: { parts: [{ inlineData: { data: "aGk=" } }] } }],
    })));
    const result = await image("gemini", { binaryOutput: true });
    expect(await result.response.text()).toBe("hi");
    expect(result.accounting).toMatchObject({
      state: "complete", tokens: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
      nativeUnits: { images: 1 }, cost: null, costStatus: "unknown",
      meta: { providerUsage: { path: "usageMetadata", value: usageMetadata } },
    });
  });

  it("preserves OpenRouter zero-dollar receipts without repricing image units", async () => {
    const payload = { created: 1, data: [{ b64_json: "aGk=" }], usage: { cost: 0, total_tokens: 3 } };
    vi.stubGlobal("fetch", vi.fn(async () => json(payload)));
    const result = await image("openrouter");
    expect(await result.response.json()).toEqual(payload);
    expect(result.accounting).toMatchObject({ cost: 0, costStatus: "known", costSource: "provider", nativeUnits: { images: 1 } });
    expect(result.accounting.tokens.input_tokens).toBeUndefined();
  });

  it("keeps malformed receipts unknown instead of coercing them to free", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: [], usage: { cost: "" } })));
    const result = await image("openrouter");
    expect(result.accounting).toMatchObject({ cost: null, costStatus: "unknown", meta: { providerCost: { path: "usage.cost", value: "" } } });
  });

  it("does not expose adapter-generated zero usage as provider usage", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ embedding: { values: [0.25] } })));
    const result = await handleEmbeddingsCore({ body: { input: "fixture" }, modelInfo: { provider: "gemini", model: "text-embedding-004" }, credentials });
    expect((await result.response.json()).usage).toEqual({ prompt_tokens: 0, total_tokens: 0 });
    expect(result.accounting.tokens).toEqual({});
    expect(result.accounting.meta.providerUsage).toBeUndefined();
  });

  it("distinguishes provider-reported zero Ollama counts from missing counts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ embeddings: [[0.25]], prompt_eval_count: 0 })));
    const result = await handleEmbeddingsCore({ body: { input: "fixture" }, modelInfo: { provider: "ollama-local", model: "nomic-embed-text" }, credentials });
    expect(result.accounting.tokens).toEqual({ input_tokens: 0 });
    expect(result.accounting.meta.providerUsage.path).toBe("prompt_eval_count");
  });

  it("preserves edit response bytes and receipt metadata separately", async () => {
    const text = '{ "data": [{"url":"https://fixture.test/image"}], "usage": {"input_tokens":2,"cost_usd":0.03} }';
    vi.stubGlobal("fetch", vi.fn(async () => new Response(text)));
    const formData = new FormData();
    formData.set("prompt", "fixture");
    const result = await handleImageEditCore({ formData, modelInfo: { provider: "openai", model: "gpt-image-1" }, credentials });
    expect(await result.response.text()).toBe(text);
    expect(result.accounting).toMatchObject({ nativeUnits: { images: 1 }, tokens: { input_tokens: 2 }, cost: 0.03, costStatus: "known" });
  });

  const event = (type, data) => `event: ${type}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`;
  const item = event("response.output_item.done", { item: { type: "image_generation_call", result: "aGk=" } });
  const completed = event("response.completed", { response: { status: "completed", usage: { input_tokens: 11, output_tokens: 7, cost_usd: 0 } } });

  it("handles split frames and stops parsing while client applies backpressure", async () => {
    const chunks = [item.slice(0, 9), item.slice(9), completed];
    let reads = 0;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new TextEncoder().encode(chunks[reads++])); },
    }, { highWaterMark: 0 }))));
    const onRequestSuccess = vi.fn();
    const result = await image("codex", { streamToClient: true, onRequestSuccess });
    expect(reads).toBe(0);
    const reader = result.response.body.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: progress");
    expect(reads).toBe(2);
    expect(onRequestSuccess).not.toHaveBeenCalled();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: done");
    expect(await reader.read()).toEqual({ done: true, value: undefined });
    expect(await result.completion).toMatchObject({ status: "success" });
  });

  it.each(["Error", "AbortError"])("settles upstream %s without successful use", async (name) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({
      pull(controller) { const error = new Error("transport lost"); error.name = name; controller.error(error); },
    }))));
    const onRequestSuccess = vi.fn();
    const result = await image("codex", { streamToClient: true, onRequestSuccess });
    expect(await result.response.text()).toContain("transport lost");
    expect(await result.completion).toMatchObject({ status: name === "AbortError" ? "abort" : "failure" });
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });

  it("awaits final accounting with receipts before delivering done", async () => {
    let finish;
    let entered;
    const enteredCallback = new Promise((resolve) => { entered = resolve; });
    const persistence = new Promise((resolve) => { finish = resolve; });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(item + completed)));
    const onStreamComplete = vi.fn(async (outcome) => {
      expect(outcome).toMatchObject({ status: "success", accounting: { state: "complete", nativeUnits: { images: 1 } } });
      entered();
      await persistence;
    });
    const result = await image("codex", { streamToClient: true, onStreamComplete });
    expect(result.response.bodyUsed).toBe(false);
    expect(result.accounting.state).toBe("pending");
    let delivered = false;
    const body = result.response.text().then((text) => { delivered = true; return text; });
    await enteredCallback;
    expect(delivered).toBe(false);
    finish();
    expect(await body).toContain('"b64_json":"aGk="');
    expect(await result.completion).toMatchObject({ status: "success", accounting: {
      state: "complete", tokens: { input_tokens: 11, output_tokens: 7 }, cost: 0,
      meta: { providerUsage: { path: "response.usage" } },
    } });
    expect(onStreamComplete).toHaveBeenCalledOnce();
    expect(JSON.parse(JSON.stringify(result.accounting)).meta.providerReceipts).toEqual([
      { providerUsage: { path: "response.usage", value: { input_tokens: 11, output_tokens: 7, cost_usd: 0 } },
        providerCost: { path: "response.usage.cost_usd", value: 0 } },
    ]);
  });

  it.each([
    item,
    item + event("response.failed", { response: { error: { message: "rejected" } } }),
    item + event("response.incomplete", { response: {} }),
    item + 'event: response.completed\ndata: {bad}\n\n',
    event("response.completed", { response: { status: "completed" } }),
  ])("does not grant success for an unfinished or failed provider stream", async (text) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(text)));
    const onRequestSuccess = vi.fn();
    const result = await image("codex", { streamToClient: true, onRequestSuccess });
    expect(await result.response.text()).toContain("event: error");
    expect(await result.completion).toMatchObject({ status: "failure", accounting: { state: "failure", nativeUnits: {} } });
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });

  it("cancels an in-flight upstream read and resolves abort once", async () => {
    let reading;
    const readStarted = new Promise((resolve) => { reading = resolve; });
    const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ pull() { reading(); }, cancel }, { highWaterMark: 0 }))));
    const onRequestSuccess = vi.fn();
    const onStreamComplete = vi.fn();
    const result = await image("codex", { streamToClient: true, onRequestSuccess, onStreamComplete });
    const reader = result.response.body.getReader();
    const pending = reader.read();
    await readStarted;
    await reader.cancel("disconnected");
    expect(await pending).toEqual({ done: true, value: undefined });
    expect(await result.completion).toMatchObject({ status: "abort", accounting: { state: "abort" } });
    expect(cancel).toHaveBeenCalledOnce();
    expect(onStreamComplete).toHaveBeenCalledOnce();
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });

  it("reports callback rejection without rejecting completion or retrying persistence", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(item + completed)));
    const error = new Error("ledger unavailable");
    const onStreamComplete = vi.fn(async () => { throw error; });
    const result = await image("codex", { streamToClient: true, onStreamComplete });
    const text = await result.response.text();
    expect(text).toContain("ledger unavailable");
    expect(text).not.toContain("event: done");
    expect(await result.completion).toMatchObject({ status: "failure", callbackError: error, accounting: { state: "failure" } });
    expect(onStreamComplete).toHaveBeenCalledOnce();
  });

  it.each([
    { failure: "response.failed", reason: "generation denied", rejectCallback: false },
    { failure: "completion callback rejection", reason: "ledger unavailable", rejectCallback: true },
  ])("redacts Codex $failure diagnostics on the public SSE boundary", async ({ reason, rejectCallback }) => {
    const selectedCredentials = { apiKey: "opaque-media-1150" };
    const diagnostic = `${reason} /home/fixture/private.ts:7 Bearer fixture-bearer ${selectedCredentials.apiKey}\n at fixtureStackSentinel`;
    const callbackError = new Error(diagnostic);
    const chunks = [rejectCallback ? item + completed : event("response.failed", {
      response: { error: { message: diagnostic } },
    })];
    const cancel = vi.fn();
    const upstream = new ReadableStream({
      pull(controller) {
        const chunk = chunks.shift();
        if (chunk === undefined) controller.close();
        else controller.enqueue(new TextEncoder().encode(chunk));
      },
      cancel,
    }, { highWaterMark: 0 });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(upstream)));
    const onRequestSuccess = vi.fn();
    const onStreamComplete = vi.fn(async (outcome) => {
      expect(outcome).toMatchObject({
        status: rejectCallback ? "success" : "failure",
        accounting: { state: rejectCallback ? "complete" : "failure" },
      });
      if (rejectCallback) throw callbackError;
    });
    const result = await image("codex", {
      credentials: selectedCredentials, streamToClient: true, onRequestSuccess, onStreamComplete,
    });
    const text = await result.response.text();
    const outcome = await result.completion;
    expect(outcome).toMatchObject({ status: "failure", accounting: { state: "failure" } });
    expect(result.accounting.state).toBe("failure");
    expect(cancel).toHaveBeenCalledOnce();
    expect(upstream.locked).toBe(false);
    expect(onStreamComplete).toHaveBeenCalledOnce();
    if (rejectCallback) {
      // Account health runs before persistence; a rejected ledger write is not retried.
      expect(onRequestSuccess).toHaveBeenCalledOnce();
      expect(outcome.callbackError).toBe(callbackError);
      expect(result.accounting.nativeUnits).toEqual({ images: 1 });
    } else {
      expect(onRequestSuccess).not.toHaveBeenCalled();
      expect(result.accounting.nativeUnits).toEqual({});
    }
    const frames = text.trim().split(/\r?\n\r?\n/).map((frame) => {
      const lines = frame.split(/\r?\n/);
      return {
        event: lines.find((line) => line.startsWith("event: "))?.slice(7),
        data: JSON.parse(lines.filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n")),
      };
    });
    const errors = frames.filter((frame) => frame.event === "error");
    expect(errors).toHaveLength(1);
    expect(frames.at(-1).event).toBe("error");
    expect(frames.some((frame) => frame.event === "done")).toBe(false);
    expect(errors[0].data.message).toContain(reason);
    for (const sentinel of ["/home/fixture/private.ts", "fixture-bearer", "opaque-media-1150", "fixtureStackSentinel"]) {
      expect.soft(text).not.toContain(sentinel);
    }
  }, 2000);

  it("does not persist when account-health completion fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(item + completed)));
    const onStreamComplete = vi.fn();
    const result = await image("codex", {
      streamToClient: true,
      onRequestSuccess: async () => { throw new Error("account health unavailable"); },
      onStreamComplete,
    });
    expect(await result.response.text()).toContain("account health unavailable");
    expect(await result.completion).toMatchObject({ status: "failure", accounting: { state: "failure" } });
    expect(onStreamComplete).not.toHaveBeenCalled();
  });

  it("preserves buffered Codex receipts without leaking them into image JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(item + completed)));
    const result = await image("codex");
    expect(await result.response.json()).toEqual({ created: expect.any(Number), data: [{ b64_json: "aGk=" }] });
    expect(result.accounting).toMatchObject({ cost: 0, nativeUnits: { images: 1 }, tokens: { input_tokens: 11 } });
  });
});

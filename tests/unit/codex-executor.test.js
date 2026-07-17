import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

const encoder = new TextEncoder();

function makeResponse(bodyChunks, status = 200) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of bodyChunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), { status, headers: { "Content-Type": "text/event-stream" } });
}

function outputResponse(text = "hi") {
  return makeResponse([
    "event: response.output_text.delta\n",
    `data: ${JSON.stringify({ type: "response.output_text.delta", delta: text })}\n\n`,
  ]);
}

function retryResponse() {
  return makeResponse([
    "event: error\n",
    'data: {"error":{"type":"service_unavailable_error","message":"Please retry"}}\n\n',
  ]);
}

function makeExecutor(retry = { attempts: 3, delayMs: 0 }) {
  const executor = new CodexExecutor();
  executor.config = {
    ...executor.config,
    baseUrl: "https://api.openai.test/v1/responses",
    baseUrls: undefined,
    retry: { ...executor.config.retry, 503: retry },
  };
  return executor;
}

describe("Codex executor request isolation", () => {
  const fetchMock = vi.mocked(proxyAwareFetch);

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => outputResponse());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("routes concurrent compact and regular requests with independent sessions", async () => {
    const executor = makeExecutor();
    const credentials = { apiKey: "key-1", connectionId: "connection-1" };
    const compactBody = { model: "gpt-5.3-codex", input: [{ role: "user", content: "compact me" }] };
    const regularBody = { model: "gpt-5.3-codex", input: [{ role: "user", content: "keep me" }] };

    const results = await Promise.all([
      executor.execute({
        model: "gpt-5.3-codex",
        body: compactBody,
        stream: true,
        credentials,
        requestContext: { compact: true, clientHeaders: { "x-session-id": "compact-session" } },
      }),
      executor.execute({
        model: "gpt-5.3-codex",
        body: regularBody,
        stream: true,
        credentials,
        requestContext: { compact: false, clientHeaders: { "x-session-id": "regular-session" } },
      }),
    ]);
    await Promise.all(results.map((result) => result.response.text()));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const calls = fetchMock.mock.calls.map(([url, init]) => ({
      url,
      headers: init.headers,
      body: JSON.parse(init.body),
    }));
    const compactCall = calls.find((call) => call.url.endsWith("/compact"));
    const regularCall = calls.find((call) => !call.url.endsWith("/compact"));

    expect(compactCall).toMatchObject({
      url: "https://api.openai.test/v1/responses/compact",
      headers: { session_id: "compact-session" },
      body: { prompt_cache_key: "compact-session" },
    });
    expect(regularCall).toMatchObject({
      url: "https://api.openai.test/v1/responses",
      headers: { session_id: "regular-session" },
      body: { prompt_cache_key: "regular-session" },
    });
    expect(compactBody).toEqual({ model: "gpt-5.3-codex", input: [{ role: "user", content: "compact me" }] });
    expect(regularBody).toEqual({ model: "gpt-5.3-codex", input: [{ role: "user", content: "keep me" }] });
    expect(credentials).not.toHaveProperty("_isCompact");
  });

  it("accepts the legacy compact marker without forwarding or mutating it", async () => {
    const executor = makeExecutor();
    const body = { _compact: true, model: "gpt-5.3-codex", input: [{ role: "user", content: "hi" }] };
    const credentials = { apiKey: "key-1", connectionId: "connection-1" };

    const result = await executor.execute({ model: "gpt-5.3-codex", body, stream: true, credentials });
    await result.response.text();

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.openai.test/v1/responses/compact");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty("_compact");
    expect(body._compact).toBe(true);
    expect(credentials).not.toHaveProperty("_isCompact");
  });

  it("clones the caller body before image normalization and transformation", async () => {
    const executor = makeExecutor();
    const body = {
      model: "gpt-5.3-codex",
      input: [{
        role: "user",
        content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AA==", detail: "low" } }],
      }],
    };

    const result = await executor.execute({
      model: "gpt-5.3-codex",
      body,
      stream: true,
      credentials: { apiKey: "key-1", connectionId: "connection-1" },
    });
    await result.response.text();

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.input[0].content[0]).toEqual({
      type: "input_image",
      image_url: "data:image/png;base64,AA==",
      detail: "low",
    });
    expect(body.input[0].content[0].type).toBe("image_url");
    expect(body).not.toHaveProperty("prompt_cache_key");
  });

  it("uses a fresh transformed body for every SSE retry", async () => {
    const executor = makeExecutor({ attempts: 1, delayMs: 0 });
    fetchMock
      .mockImplementationOnce(async () => retryResponse())
      .mockImplementationOnce(async () => outputResponse("ok"));
    const body = { model: "gpt-5.3-codex", input: [{ role: "user", content: "retry" }] };

    const result = await executor.execute({
      model: "gpt-5.3-codex",
      body,
      stream: true,
      credentials: { apiKey: "key-1", connectionId: "connection-1" },
      requestContext: { compact: false, clientHeaders: { "x-session-id": "retry-session" } },
    });
    await result.response.text();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sentBodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(sentBodies[0]).toEqual(sentBodies[1]);
    expect(sentBodies[0]).not.toHaveProperty("_compact");
    expect(sentBodies[0].prompt_cache_key).toBe("retry-session");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://api.openai.test/v1/responses",
      "https://api.openai.test/v1/responses",
    ]);
    expect(body).toEqual({ model: "gpt-5.3-codex", input: [{ role: "user", content: "retry" }] });
  });


  it("preserves compact and session context across base-URL fallback", async () => {
    const executor = makeExecutor();
    executor.config = {
      ...executor.config,
      baseUrl: undefined,
      baseUrls: [
        "https://first.openai.test/v1/responses",
        "https://second.openai.test/v1/responses",
      ],
    };
    fetchMock
      .mockImplementationOnce(async () => new Response("rate limited", { status: 429 }))
      .mockImplementationOnce(async () => outputResponse("fallback"));

    const result = await executor.execute({
      model: "gpt-5.3-codex",
      body: { model: "gpt-5.3-codex", input: "fallback" },
      stream: true,
      credentials: { apiKey: "key-1", connectionId: "connection-1" },
      requestContext: { compact: true, clientHeaders: { "x-session-id": "fallback-session" } },
    });
    await result.response.text();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://first.openai.test/v1/responses/compact",
      "https://second.openai.test/v1/responses/compact",
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.headers.session_id).toBe("fallback-session");
      expect(JSON.parse(init.body).prompt_cache_key).toBe("fallback-session");
    }
  });

  it("makes four total requests when the default three SSE retries are exhausted", async () => {
    const executor = makeExecutor({ attempts: 3, delayMs: 0 });
    fetchMock.mockImplementation(async () => retryResponse());

    const result = await executor.execute({
      model: "gpt-5.3-codex",
      body: { model: "gpt-5.3-codex", input: "retry" },
      stream: true,
      credentials: { apiKey: "key-1", connectionId: "connection-1" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.response.status).toBe(503);
    await expect(result.response.json()).resolves.toMatchObject({ error: { message: "Please retry" } });
  });

  it("aborts an SSE retry delay without issuing another fetch", async () => {
    const executor = makeExecutor({ attempts: 3, delayMs: 30_000 });
    fetchMock.mockImplementation(async () => retryResponse());
    const controller = new AbortController();

    const pending = executor.execute({
      model: "gpt-5.3-codex",
      body: { model: "gpt-5.3-codex", input: "retry" },
      stream: true,
      credentials: { apiKey: "key-1", connectionId: "connection-1" },
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort(new DOMException("client disconnected", "AbortError"));

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("forwards the Responses Lite transport contract over SSE", async () => {
    const executor = makeExecutor();
    const credentials = {
      apiKey: "key-1",
      connectionId: "connection-1",
    };
    const clientHeaders = {
      "x-openai-internal-codex-responses-lite": "true",
      "user-agent": "codex_exec/0.144.1",
      originator: "codex_exec",
      "x-client-request-id": "request-id",
      "x-codex-turn-metadata": "turn-metadata",
      "x-forwarded-for": "203.0.113.1",
    };

    const result = await executor.execute({
      model: "gpt-5.3-codex",
      body: {
        model: "gpt-5.3-codex",
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }],
        parallel_tool_calls: false,
      },
      stream: true,
      credentials,
      requestContext: { compact: false, clientHeaders },
    });
    const sseText = await result.response.text();
    const sseFrames = sseText.split(/\r?\n\r?\n/).filter(Boolean);
    const dataPayloads = sseFrames
      .map((frame) => frame.split(/\r?\n/).find((line) => line.startsWith("data:"))?.slice(5).trim())
      .filter((data) => data && data !== "[DONE]")
      .map((data) => JSON.parse(data));
    expect(dataPayloads).toContainEqual(
      expect.objectContaining({ type: "response.output_text.delta", delta: "hi" }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.test/v1/responses");
    expect(init.headers["x-openai-internal-codex-responses-lite"]).toBe("true");
    expect(init.headers["User-Agent"]).toBe("codex_exec/0.144.1");
    expect(init.headers.originator).toBe("codex_exec");
    expect(init.headers["x-client-request-id"]).toBe("request-id");
    expect(init.headers["x-codex-turn-metadata"]).toBe("turn-metadata");
    expect(init.headers["x-forwarded-for"]).toBeUndefined();
    const sent = JSON.parse(init.body);
    expect(sent.stream).toBe(true);
    expect(sent.parallel_tool_calls).toBe(false);
  });

  it("keeps Responses Lite compact requests on the compact contract", async () => {
    const executor = makeExecutor();
    const clientHeaders = { "x-openai-internal-codex-responses-lite": "true" };

    const result = await executor.execute({
      model: "gpt-5.3-codex",
      body: {
        model: "gpt-5.3-codex",
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
        stream: true,
        store: false,
        include: ["reasoning.encrypted_content"],
        client_metadata: { thread_id: "test" },
        parallel_tool_calls: false,
      },
      stream: true,
      credentials: { apiKey: "key-1", connectionId: "connection-1" },
      requestContext: { compact: true, clientHeaders },
    });
    await result.response.text();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.test/v1/responses/compact");
    expect(init.headers["x-openai-internal-codex-responses-lite"]).toBe("true");
    const sent = JSON.parse(init.body);
    // Compact body contract: stream/store/include stripped, parallel_tool_calls kept.
    expect(sent.stream).toBeUndefined();
    expect(sent.store).toBeUndefined();
    expect(sent.include).toBeUndefined();
    expect(sent.client_metadata).toBeUndefined();
    expect(sent.parallel_tool_calls).toBe(false);
  });

  it("does not forward Responses Lite without the client opt-in header", async () => {
    const executor = makeExecutor();
    const result = await executor.execute({
      model: "gpt-5.3-codex",
      body: { model: "gpt-5.3-codex", input: "hello" },
      stream: true,
      credentials: { apiKey: "key-1", connectionId: "connection-1" },
      requestContext: { compact: false, clientHeaders: {} },
    });
    await result.response.text();

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["x-openai-internal-codex-responses-lite"]).toBeUndefined();
  });
});

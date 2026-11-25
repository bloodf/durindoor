/**
 * OmniRoute #937 (head bcc374eb312200c2c37f35b74ef4b2a281872a90, merged as
 * 954c40067e7cb31857dfba1e9fbc1c8b6bb43977): the GitHub executor must run its
 * SSE transforms only on a successful event-stream response.
 *
 * Before the port, a successful response whose media type was not
 * `text/event-stream` was still piped through the Claude / Responses SSE
 * translator, so an upstream JSON or plain-text body was rewritten into a
 * `stream_error` frame and the upstream body was lost. After the port such a
 * response keeps its status, headers and readable body, and the gateway
 * classifies it. Genuine event streams keep the existing validation, and a
 * non-success response keeps its existing handling.
 *
 * Offline only: the upstream fetch is mocked, no provider traffic, no
 * credentials.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { handleStreamingResponse } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const { proxyAwareFetch } = vi.hoisted(() => ({ proxyAwareFetch: vi.fn() }));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch,
}));

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
  saveUsageStats: vi.fn(async () => {}),
  extractRequestConfig: vi.fn(() => ({})),
  buildRequestDetail: vi.fn((args) => args),
  formatDoneLine: vi.fn(() => "done"),
}));

const { GithubExecutor } = await import("../../open-sse/executors/github.js");

const CREDENTIALS = { accessToken: "tok", copilotToken: "ghu_test" };

/** Claude-native event-stream frames used by the /v1/messages route. */
const CLAUDE_FRAMES = [
  ["message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-4.6", content: [], usage: { input_tokens: 11, output_tokens: 1 } } }],
  ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
  ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } }],
  ["content_block_stop", { type: "content_block_stop", index: 0 }],
  ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } }],
  ["message_stop", { type: "message_stop" }],
];

function claudeEventStream(frames = CLAUDE_FRAMES) {
  let out = "";
  for (const [event, payload] of frames) out += `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  return out;
}

/** Responses-native event-stream frames used by the /responses route. */
function responsesEventStream() {
  return [
    `event: response.created\ndata: ${JSON.stringify({ type: "response.created", response: { id: "resp_1", status: "in_progress" } })}`,
    `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: "hi" })}`,
    `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { id: "resp_1", status: "completed" } })}`,
    "data: [DONE]",
    "",
  ].join("\n\n");
}

function upstreamResponse(body, { status = 200, contentType = "application/json" } = {}) {
  return new Response(body, { status, headers: { "content-type": contentType } });
}

async function readStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

/** Run the Claude /v1/messages route against a mocked upstream response. */
function runMessagesRoute(response, overrides = {}) {
  proxyAwareFetch.mockResolvedValueOnce(response);
  return new GithubExecutor().executeWithMessagesEndpoint({
    model: "claude-sonnet-4.6",
    body: { messages: [{ role: "user", content: "hi" }], max_tokens: 16 },
    stream: false,
    credentials: CREDENTIALS,
    log: { debug: vi.fn(), warn: vi.fn() },
    ...overrides,
  });
}

/** Run the /responses route against a mocked upstream response. */
function runResponsesRoute(response, overrides = {}) {
  proxyAwareFetch.mockResolvedValueOnce(response);
  return new GithubExecutor().executeWithResponsesEndpoint({
    model: "gpt-5.5-codex",
    body: { messages: [{ role: "user", content: "hi" }] },
    stream: false,
    credentials: CREDENTIALS,
    log: { debug: vi.fn(), warn: vi.fn() },
    ...overrides,
  });
}

beforeEach(() => {
  proxyAwareFetch.mockReset();
});

describe("GitHub Claude /v1/messages route: event-stream precondition", () => {
  it("keeps a successful JSON response readable instead of rewriting it into a stream_error frame", async () => {
    const body = JSON.stringify({ error: { message: "boom", code: "model_not_available" } });
    const result = await runMessagesRoute(upstreamResponse(body));

    expect(result.response.status).toBe(200);
    expect(result.response.headers.get("content-type")).toBe("application/json");
    expect(await result.response.text()).toBe(body);
    expect(result.terminalProvenance).toBe("upstream");
  });

  it("keeps a successful plain-text response readable", async () => {
    const body = "IDE token expired: unauthorized: token expired\n";
    const result = await runMessagesRoute(upstreamResponse(body, { contentType: "text/plain; charset=utf-8" }));

    expect(result.response.status).toBe(200);
    expect(result.response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await result.response.text()).toBe(body);
  });

  it("keeps the upstream status and headers of a successful non-SSE response", async () => {
    const result = await runMessagesRoute(upstreamResponse("{\"ok\":true}", {
      contentType: "application/json; charset=utf-8",
    }));

    expect(result.response.status).toBe(200);
    expect(result.response.headers.get("content-type")).toBe("application/json; charset=utf-8");
  });

  it("still translates a genuine event-stream response", async () => {
    const result = await runMessagesRoute(upstreamResponse(claudeEventStream(), {
      contentType: "text/event-stream",
    }));

    expect(result.terminalProvenance).toBe("validated");
    const out = await readStream(result.response);
    expect(out).toContain('"content":"hi"');
    expect(out).toContain('"finish_reason":"stop"');
    expect(out).toContain("data: [DONE]");
    expect(out).not.toContain("stream_error");
  });

  it("still translates an event-stream response that carries a charset", async () => {
    const result = await runMessagesRoute(upstreamResponse(claudeEventStream(), {
      contentType: "text/event-stream; charset=utf-8",
    }));

    expect(result.terminalProvenance).toBe("validated");
    expect(await readStream(result.response)).toContain("data: [DONE]");
  });

  it("keeps the existing handling of a non-success response", async () => {
    const body = "IDE token expired: unauthorized: token expired\n";
    const result = await runMessagesRoute(upstreamResponse(body, {
      status: 401,
      contentType: "text/plain; charset=utf-8",
    }));

    expect(result.response.status).toBe(401);
    expect(await result.response.text()).toBe(body);
    expect(result.terminalProvenance).toBeUndefined();
  });

  it("keeps the upstream request forced to streaming and its headers unchanged", async () => {
    await runMessagesRoute(upstreamResponse(claudeEventStream(), { contentType: "text/event-stream" }));

    const [, init] = proxyAwareFetch.mock.calls[0];
    expect(init.headers["Accept"]).toBe("text/event-stream");
    expect(JSON.parse(init.body).stream).toBe(true);
    expect(init.signal).toBeDefined();
  });
});

describe("GitHub /responses route: event-stream precondition", () => {
  it("keeps a successful JSON response readable instead of rewriting it into a stream_error frame", async () => {
    const body = JSON.stringify({ error: { message: "boom", code: "unsupported_api_for_model" } });
    const result = await runResponsesRoute(upstreamResponse(body));

    expect(result.response.status).toBe(200);
    expect(result.response.headers.get("content-type")).toBe("application/json");
    expect(await result.response.text()).toBe(body);
    expect(result.terminalProvenance).toBe("upstream");
  });

  it("keeps a successful plain-text response readable", async () => {
    const body = "not an event stream\n";
    const result = await runResponsesRoute(upstreamResponse(body, { contentType: "text/plain" }));

    expect(result.response.status).toBe(200);
    expect(await result.response.text()).toBe(body);
  });

  it("still translates a genuine event-stream response", async () => {
    const result = await runResponsesRoute(upstreamResponse(responsesEventStream(), {
      contentType: "text/event-stream",
    }));

    expect(result.terminalProvenance).toBe("validated");
    const out = await readStream(result.response);
    expect(out).toContain('"content":"hi"');
    expect(out).toContain("data: [DONE]");
    expect(out).not.toContain("stream_error");
  });

  it("keeps the existing handling of a non-success response", async () => {
    const body = "IDE token expired: unauthorized: token expired\n";
    const result = await runResponsesRoute(upstreamResponse(body, {
      status: 401,
      contentType: "text/plain; charset=utf-8",
    }));

    expect(result.response.status).toBe(401);
    expect(await result.response.text()).toBe(body);
    expect(result.terminalProvenance).toBeUndefined();
  });
});

describe("GitHub executor: caller abort is not converted into a response", () => {
  it("propagates a caller abort instead of returning a body", async () => {
    const controller = new AbortController();
    controller.abort();
    proxyAwareFetch.mockImplementationOnce(async (_url, init) => {
      if (init?.signal?.aborted) {
        const error = new Error("The operation was aborted");
        error.name = "AbortError";
        throw error;
      }
      return upstreamResponse(claudeEventStream(), { contentType: "text/event-stream" });
    });

    await expect(runMessagesRoute(upstreamResponse("{}", { contentType: "application/json" }), {
      signal: controller.signal,
    })).rejects.toThrow(/abort/i);
  });
});

describe("Gateway dispatch: a passthrough body reaches the client contract", () => {
  const gatewayOptions = (providerResponse, overrides = {}) => ({
    providerResponse,
    provider: "github",
    model: "claude-sonnet-4.6",
    sourceFormat: FORMATS.OPENAI,
    targetFormat: FORMATS.OPENAI,
    body: { messages: [{ role: "user", content: "hi" }] },
    stream: false,
    translatedBody: null,
    finalBody: null,
    requestStartTime: Date.now(),
    connectionId: "connection-937",
    onRequestSuccess: vi.fn(async () => {}),
    trackDone: vi.fn(),
    appendLog: vi.fn(),
    reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
    log: { line: vi.fn(), debug: vi.fn(), warn: vi.fn() },
    terminalProvenance: "upstream",
    clientRawRequest: { endpoint: "/v1/chat/completions" },
    ...overrides,
  });

  it("serves a successful JSON completion that the executor passed through", async () => {
    const completion = {
      id: "chatcmpl-937",
      object: "chat.completion",
      created: 1700000000,
      model: "claude-sonnet-4.6",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "documented answer" } }],
      usage: { prompt_tokens: 11, completion_tokens: 2, total_tokens: 13 },
    };
    const result = await runMessagesRoute(upstreamResponse(JSON.stringify(completion)));
    expect(result.response.headers.get("content-type")).toBe("application/json");

    const gatewayResult = await handleNonStreamingResponse(gatewayOptions(result.response));
    expect(gatewayResult.success).toBe(true);
    const clientBody = await gatewayResult.response.json();
    expect(clientBody.choices[0].message.content).toBe("documented answer");
  });

  it("rejects a passed-through error envelope instead of serving a stream_error frame", async () => {
    const result = await runMessagesRoute(upstreamResponse(JSON.stringify({
      error: { message: "boom", code: "model_not_available" },
    })));

    const gatewayResult = await handleNonStreamingResponse(gatewayOptions(result.response));
    expect(gatewayResult.success).toBe(false);
    expect(gatewayResult.response.headers.get("content-type")).not.toBe("text/event-stream");
  });

  it("frames a passed-through JSON completion as SSE for a streaming client", async () => {
    const completion = {
      id: "chatcmpl-937",
      object: "chat.completion",
      created: 1700000000,
      model: "claude-sonnet-4.6",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "documented answer" } }],
    };
    const result = await runMessagesRoute(upstreamResponse(JSON.stringify(completion)));

    const handleError = vi.fn();
    const gatewayResult = await handleStreamingResponse({
      providerResponse: result.response,
      provider: "github",
      model: "claude-sonnet-4.6",
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: true,
      translatedBody: null,
      finalBody: null,
      requestStartTime: Date.now(),
      connectionId: "connection-937",
      clientRawRequest: null,
      reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
      toolNameMap: null,
      log: { debug: vi.fn(), warn: vi.fn() },
      reqTag: "",
      streamController: {
        handleError,
        startTime: Date.now(),
        isConnected: () => true,
        handleComplete: () => {},
      },
      onStreamComplete: vi.fn(),
      onStreamAbandoned: vi.fn(),
      onCoherentTerminal: vi.fn(),
      streamDetailId: "detail-937",
    });

    expect(gatewayResult.success).toBe(true);
    expect(handleError).not.toHaveBeenCalled();
    expect(gatewayResult.response.headers.get("content-type")).toContain("text/event-stream");
    const text = await gatewayResult.response.text();
    expect(text).toContain('"content":"documented answer"');
    expect(text).toContain("data: [DONE]");
    expect(text).not.toContain("stream_error");
  });

  it("rejects a passed-through body that is not an OpenAI completion for a streaming client", async () => {
    const result = await runMessagesRoute(upstreamResponse(JSON.stringify({
      error: { message: "boom", code: "model_not_available" },
    })));

    const handleError = vi.fn();
    const gatewayResult = await handleStreamingResponse({
      providerResponse: result.response,
      provider: "github",
      model: "claude-sonnet-4.6",
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: true,
      translatedBody: null,
      finalBody: null,
      requestStartTime: Date.now(),
      connectionId: "connection-937",
      clientRawRequest: null,
      reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
      toolNameMap: null,
      log: { debug: vi.fn(), warn: vi.fn() },
      reqTag: "",
      streamController: {
        handleError,
        startTime: Date.now(),
        isConnected: () => true,
        handleComplete: () => {},
      },
      onStreamComplete: vi.fn(),
      onStreamAbandoned: vi.fn(),
      onCoherentTerminal: vi.fn(),
      streamDetailId: "detail-937",
    });

    expect(gatewayResult.success).toBe(false);
    expect(gatewayResult.status).toBe(502);
    expect(handleError).toHaveBeenCalled();
  });
});

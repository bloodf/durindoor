import { afterEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { handleComboChat } from "../../open-sse/services/combo.js";
import { createStreamController } from "../../open-sse/utils/streamHandler.js";
import { resolvedModelHeaders, withRouteResponseHeaders } from "../../open-sse/utils/routeResponseHeaders.js";
import { handleStreamingResponse } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { handleForcedSSEToJson } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  trackPendingRequest: vi.fn(),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
}));

function assertNoUpstreamBrandOrSecrets(response, forbiddenValues = []) {
  for (const [name] of response.headers.entries()) {
    expect(name.toLowerCase().startsWith("x-9router-")).toBe(false);
  }
  const headerBlob = [...response.headers.entries()].map(([k, v]) => `${k}:${v}`).join("\n");
  for (const secret of forbiddenValues) {
    expect(headerBlob).not.toContain(secret);
  }
}

afterEach(() => {
  delete process.env.DURINDOOR_ROUTE_HEADERS;
  vi.clearAllMocks();
});

describe("port 9router #5802: resolvedModelHeaders", () => {
  it("emits x-durindoor-model and x-durindoor-context-window when known, never x-9router-*", () => {
    const headers = resolvedModelHeaders("claude", "claude-opus-5.5");
    expect(headers["x-durindoor-model"]).toBe("claude/claude-opus-5.5");
    expect(headers["x-durindoor-context-window"]).toBe("1000000");
    expect(headers["x-9router-model"]).toBeUndefined();
    expect(headers["x-9router-context-window"]).toBeUndefined();
  });

  it("emits bare <model> when provider is omitted and omits context window when unknown", () => {
    const knownBare = resolvedModelHeaders("", "claude-opus-5.5");
    expect(knownBare).toEqual({
      "x-durindoor-model": "claude-opus-5.5",
      "x-durindoor-context-window": "1000000",
    });

    const unknownModel = resolvedModelHeaders("deepseek", "totally-unknown-model");
    expect(unknownModel).toEqual({
      "x-durindoor-model": "deepseek/totally-unknown-model",
    });
    expect("x-durindoor-context-window" in unknownModel).toBe(false);

    const localModel = resolvedModelHeaders("ollama-local", "llama3");
    expect(localModel).toEqual({
      "x-durindoor-model": "ollama-local/llama3",
    });
  });

  it("returns empty object for missing, non-string, or unsafe header values", () => {
    expect(resolvedModelHeaders("deepseek", "")).toEqual({});
    expect(resolvedModelHeaders("deepseek", "   ")).toEqual({});
    expect(resolvedModelHeaders("deepseek", null)).toEqual({});
    expect(resolvedModelHeaders("deepseek", undefined)).toEqual({});
    expect(resolvedModelHeaders("deepseek", 123)).toEqual({});
    expect(resolvedModelHeaders("deepseek", "bad\r\nmodel")).toEqual({});
    expect(resolvedModelHeaders("bad\r\nprovider", "claude-opus-5.5")).toEqual({
      "x-durindoor-model": "claude-opus-5.5",
      "x-durindoor-context-window": "1000000",
    });
  });
});

describe("port 9router #5802: handler and combo response headers", () => {
  const credentials = {
    connectionId: "conn-secret-123",
    accountName: "acct-secret-name",
    apiKey: "sk-secret-token-xyz",
  };

  it("emits resolved headers on streaming responses without altering SSE body", async () => {
    const encoder = new TextEncoder();
    const ssePayload = 'data: {"id":"1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n';
    const upstreamBody = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(ssePayload));
        controller.close();
      },
    });
    const result = await handleStreamingResponse({
      providerResponse: new Response(upstreamBody, { headers: { "content-type": "text/event-stream" } }),
      provider: "claude",
      model: "claude-opus-5.5",
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      body: { stream: true, messages: [{ role: "user", content: "hi" }] },
      stream: true,
      requestStartTime: Date.now(),
      connectionId: credentials.connectionId,
      streamController: createStreamController({ provider: "claude", model: "claude-opus-5.5", log: { line: vi.fn() } }),
      credentials,
    });

    expect(result.success).toBe(true);
    expect(result.response.headers.get("x-durindoor-model")).toBe("claude/claude-opus-5.5");
    expect(result.response.headers.get("x-durindoor-context-window")).toBe("1000000");
    assertNoUpstreamBrandOrSecrets(result.response, [credentials.connectionId, credentials.accountName, credentials.apiKey]);
    const streamedText = await result.response.text();
    expect(streamedText).toContain('"content":"hi"');
    expect(streamedText).toContain("data: [DONE]");
  });

  it("emits resolved headers on non-streaming JSON and forced client-SSE responses without altering bodies", async () => {
    const completion = {
      id: "chatcmpl-1",
      object: "chat.completion",
      created: 123,
      model: "gpt-6.2-sol",
      choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
    };

    const jsonResult = await handleNonStreamingResponse({
      providerResponse: new Response(JSON.stringify(completion), { headers: { "content-type": "application/json" } }),
      provider: "cx",
      model: "gpt-6.2-sol",
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      body: { model: "gpt-6.2-sol", messages: [{ role: "user", content: "hi" }] },
      stream: false,
      streamToClient: false,
      requestStartTime: Date.now(),
      connectionId: credentials.connectionId,
      reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
      trackDone: vi.fn(),
      appendLog: vi.fn(),
      credentials,
    });

    expect(jsonResult.success).toBe(true);
    expect(jsonResult.response.headers.get("x-durindoor-model")).toBe("cx/gpt-6.2-sol");
    expect(jsonResult.response.headers.get("x-durindoor-context-window")).toBe("500000");
    assertNoUpstreamBrandOrSecrets(jsonResult.response, [credentials.connectionId, credentials.accountName, credentials.apiKey]);
    expect(await jsonResult.response.json()).toEqual(completion);

    const sseResult = await handleNonStreamingResponse({
      providerResponse: new Response(JSON.stringify(completion), { headers: { "content-type": "application/json" } }),
      provider: "cx",
      model: "gpt-6.2-sol",
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      body: { model: "gpt-6.2-sol", stream: true, messages: [{ role: "user", content: "hi" }] },
      stream: false,
      streamToClient: true,
      requestStartTime: Date.now(),
      connectionId: credentials.connectionId,
      reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
      trackDone: vi.fn(),
      appendLog: vi.fn(),
      credentials,
    });

    expect(sseResult.success).toBe(true);
    expect(sseResult.response.headers.get("content-type")).toContain("text/event-stream");
    expect(sseResult.response.headers.get("x-durindoor-model")).toBe("cx/gpt-6.2-sol");
    expect(sseResult.response.headers.get("x-durindoor-context-window")).toBe("500000");
    expect(await sseResult.response.text()).toContain('"content":"hello"');
  });

  it("does not emit resolved headers on non-streaming error responses", async () => {
    const errResult = await handleNonStreamingResponse({
      providerResponse: new Response("not-json", { status: 200, headers: { "content-type": "application/json" } }),
      provider: "cx",
      model: "gpt-6.2-sol",
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      body: { model: "gpt-6.2-sol", messages: [] },
      stream: false,
      requestStartTime: Date.now(),
      reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
      trackDone: vi.fn(),
      appendLog: vi.fn(),
    });

    expect(errResult.success).toBe(false);
    expect(errResult.response.headers.get("x-durindoor-model")).toBeNull();
    expect(errResult.response.headers.get("x-durindoor-context-window")).toBeNull();
  });

  it("emits resolved headers on forced-SSE-to-JSON responses (Chat and Responses API)", async () => {
    const chatSse = [
      'data: {"id":"chatcmpl-2","object":"chat.completion.chunk","created":123,"model":"claude-opus-5.5","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"},"finish_reason":null}]}',
      "",
      'data: {"id":"chatcmpl-2","object":"chat.completion.chunk","created":123,"model":"claude-opus-5.5","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    const chatResult = await handleForcedSSEToJson({
      providerResponse: new Response(chatSse, { headers: { "content-type": "text/event-stream" } }),
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      provider: "claude",
      model: "claude-opus-5.5",
      body: { model: "claude-opus-5.5", messages: [{ role: "user", content: "hi" }] },
      stream: false,
      requestStartTime: Date.now(),
      connectionId: credentials.connectionId,
      trackDone: vi.fn(),
      appendLog: vi.fn(),
      credentials,
    });

    expect(chatResult.success).toBe(true);
    expect(chatResult.response.headers.get("x-durindoor-model")).toBe("claude/claude-opus-5.5");
    expect(chatResult.response.headers.get("x-durindoor-context-window")).toBe("1000000");
    assertNoUpstreamBrandOrSecrets(chatResult.response, [credentials.connectionId, credentials.accountName, credentials.apiKey]);
    const chatJson = await chatResult.response.json();
    expect(chatJson.choices[0].message.content).toBe("ok");

    const outputItem = { id: "msg-1", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "done" }] };
    const responsesEvents = [
      { type: "response.created", response: { id: "resp-1", object: "response", created_at: 1, model: "gpt-6.2-sol" } },
      { type: "response.output_item.done", output_index: 0, item: outputItem },
      { type: "response.completed", response: { id: "resp-1", object: "response", created_at: 1, model: "gpt-6.2-sol", status: "completed", output: [outputItem], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
    ];
    const responsesSse = responsesEvents.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");

    const responsesResult = await handleForcedSSEToJson({
      providerResponse: new Response(responsesSse, { headers: { "content-type": "text/event-stream" } }),
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      targetFormat: FORMATS.OPENAI_RESPONSES,
      provider: "codex",
      model: "gpt-6.2-sol",
      body: { model: "gpt-6.2-sol", input: "hi" },
      stream: false,
      requestStartTime: Date.now(),
      connectionId: credentials.connectionId,
      trackDone: vi.fn(),
      appendLog: vi.fn(),
      credentials,
    });

    expect(responsesResult.success).toBe(true);
    expect(responsesResult.response.headers.get("x-durindoor-model")).toBe("codex/gpt-6.2-sol");
    expect(responsesResult.response.headers.get("x-durindoor-context-window")).toBe("500000");
    assertNoUpstreamBrandOrSecrets(responsesResult.response, [credentials.connectionId, credentials.accountName, credentials.apiKey]);
    const respJson = await responsesResult.response.json();
    expect(respJson.status).toBe("completed");
    expect(respJson.output[0].content[0].text).toBe("done");

    const projectedResult = await handleForcedSSEToJson({
      providerResponse: new Response(responsesSse, { headers: { "content-type": "text/event-stream" } }),
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI_RESPONSES,
      provider: "codex",
      model: "gpt-6.2-sol",
      body: { model: "gpt-6.2-sol", messages: [{ role: "user", content: "hi" }] },
      stream: false,
      requestStartTime: Date.now(),
      connectionId: credentials.connectionId,
      trackDone: vi.fn(),
      appendLog: vi.fn(),
      credentials,
    });

    expect(projectedResult.success).toBe(true);
    expect(projectedResult.response.headers.get("x-durindoor-model")).toBe("codex/gpt-6.2-sol");
    expect(projectedResult.response.headers.get("x-durindoor-context-window")).toBe("500000");
    assertNoUpstreamBrandOrSecrets(projectedResult.response, [credentials.connectionId, credentials.accountName, credentials.apiKey]);
    const projectedJson = await projectedResult.response.json();
    expect(projectedJson.choices[0].message.content).toBe("done");
  });

  it("preserves winning <provider>/<model> and context window across combo fallback and withRouteResponseHeaders", async () => {
    const handleSingleModel = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ error: { message: "rate limited" } }, { status: 429 }))
      .mockImplementationOnce(async () => {
        const res = await handleNonStreamingResponse({
          providerResponse: new Response(JSON.stringify({
            id: "chatcmpl-win",
            object: "chat.completion",
            created: 123,
            model: "claude-opus-5.5",
            choices: [{ index: 0, message: { role: "assistant", content: "winner" }, finish_reason: "stop" }],
          }), { headers: { "content-type": "application/json" } }),
          provider: "claude",
          model: "claude-opus-5.5",
          sourceFormat: FORMATS.OPENAI,
          targetFormat: FORMATS.OPENAI,
          body: { model: "claude-opus-5.5", messages: [{ role: "user", content: "hi" }] },
          stream: false,
          requestStartTime: Date.now(),
          connectionId: credentials.connectionId,
          reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
          trackDone: vi.fn(),
          appendLog: vi.fn(),
          credentials,
        });
        return withRouteResponseHeaders(res.response, { provider: "claude", model: "claude-opus-5.5", attempts: 1 });
      });

    const response = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["openai/unknown-a", "claude/claude-opus-5.5"],
      handleSingleModel,
      log: { info: vi.fn(), warn: vi.fn() },
      comboName: "fallback-combo",
      comboStrategy: "fallback",
      jevClassify: true,
    });

    expect(response.headers.get("x-durindoor-model")).toBe("claude/claude-opus-5.5");
    expect(response.headers.get("x-durindoor-context-window")).toBe("1000000");
    expect(response.headers.get("x-durindoor-provider")).toBe("claude");
    expect(response.headers.get("x-durindoor-combo")).toBe("fallback-combo");
    expect(response.headers.get("x-durindoor-attempts")).toBe("2");
    expect(response.headers.get("access-control-expose-headers")).toContain("x-durindoor-context-window");
    assertNoUpstreamBrandOrSecrets(response, [credentials.connectionId, credentials.accountName, credentials.apiKey]);
    expect((await response.json()).choices[0].message.content).toBe("winner");
  });
});

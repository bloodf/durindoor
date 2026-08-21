import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { openaiResponsesToOpenAIRequest } = await import("../../open-sse/translator/request/openai-responses.js");
const { stripInternalKeys, validateOutboundPayload } = await import("../../open-sse/translator/validate.js");
const { translateNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");

const CUSTOM_NAME = "apply_patch";
const FUNCTION_NAME = "get_weather";
const RAW_INPUT = "*** Begin Patch\n*** Update File: example.js\n*** End Patch";

function translatedRequest() {
  return openaiResponsesToOpenAIRequest("gpt-test", {
    model: "gpt-test",
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Run tools" }] }],
    tools: [
      { type: "custom", name: CUSTOM_NAME, description: "Apply a raw patch" },
      { type: "function", name: FUNCTION_NAME, parameters: { type: "object", properties: {} } },
    ],
  }, false, {});
}

function chatCompletion() {
  return {
    id: "chatcmpl-custom",
    object: "chat.completion",
    created: 123,
    model: "gpt-test",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_custom",
            type: "function",
            function: { name: CUSTOM_NAME, arguments: JSON.stringify({ input: RAW_INPUT }) },
          },
          {
            id: "call_function",
            type: "function",
            function: { name: FUNCTION_NAME, arguments: "{\"city\":\"Paris\"}" },
          },
        ],
      },
      finish_reason: "tool_calls",
    }],
    usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
  };
}

function chatSse() {
  const body = chatCompletion();
  return [
    `data: ${JSON.stringify({
      id: body.id,
      created: body.created,
      model: body.model,
      choices: [{ index: 0, delta: { role: "assistant", tool_calls: body.choices[0].message.tool_calls.map((call, index) => ({ index, ...call })) }, finish_reason: null }],
    })}`,
    `data: ${JSON.stringify({
      id: body.id,
      created: body.created,
      model: body.model,
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      usage: body.usage,
    })}`,
    "data: [DONE]",
    "",
  ].join("\n\n");
}

function forcedContext(raw, {
  sourceFormat = FORMATS.OPENAI_RESPONSES,
  targetFormat = FORMATS.OPENAI,
  provider = "openai",
} = {}) {
  return {
    providerResponse: new Response(raw, { headers: { "content-type": "text/event-stream" } }),
    sourceFormat,
    targetFormat,
    provider,
    model: "gpt-test",
    body: { model: "gpt-test", stream: false },
    stream: true,
    translatedBody: null,
    finalBody: null,
    customToolNames: translatedRequest()._customToolNames,
    requestStartTime: Date.now(),
    connectionId: "connection-test",
    apiKey: null,
    clientRawRequest: { endpoint: "/v1/responses" },
    onRequestSuccess: vi.fn(async () => {}),
    trackDone: vi.fn(),
    appendLog: vi.fn(),
    log: { line: vi.fn(), debug: vi.fn() },
    usageEventId: "event-test",
    terminalProvenance: "upstream",
  };
}

describe("Responses custom tools on buffered routes (#3373)", () => {
  it("carries translator metadata as an array and restores custom semantics on non-stream responses", () => {
    const customToolNames = translatedRequest()._customToolNames;
    expect(Array.isArray(customToolNames)).toBe(true);
    expect(validateOutboundPayload(FORMATS.OPENAI, translatedRequest())).toMatchObject({
      ok: false,
      errors: [expect.objectContaining({ path: "_customToolNames" })],
    });
    const providerBody = { ...translatedRequest() };
    stripInternalKeys(providerBody);
    expect(providerBody._customToolNames).toBeUndefined();

    const response = translateNonStreamingResponse(
      chatCompletion(),
      FORMATS.OPENAI,
      FORMATS.OPENAI_RESPONSES,
      { customToolNames },
    );

    expect(response.output).toContainEqual(expect.objectContaining({
      type: "custom_tool_call",
      call_id: "call_custom",
      name: CUSTOM_NAME,
      input: RAW_INPUT,
    }));
    expect(response.output).toContainEqual(expect.objectContaining({
      type: "function_call",
      call_id: "call_function",
      name: FUNCTION_NAME,
      arguments: "{\"city\":\"Paris\"}",
    }));
  });

  it("handles absent and empty metadata at the non-stream consumer", () => {
    for (const customToolNames of [undefined, [], new Set()]) {
      const response = translateNonStreamingResponse(
        chatCompletion(),
        FORMATS.OPENAI,
        FORMATS.OPENAI_RESPONSES,
        { customToolNames },
      );
      expect(response.output.find((item) => item.call_id === "call_custom")?.type).toBe("function_call");
    }
  });

  it("restores custom semantics on the forced-SSE-to-JSON route", async () => {
    const result = await handleForcedSSEToJson(forcedContext(chatSse()));
    expect(result.success).toBe(true);
    const response = await result.response.json();

    expect(response.output).toContainEqual(expect.objectContaining({
      type: "custom_tool_call",
      call_id: "call_custom",
      name: CUSTOM_NAME,
      input: RAW_INPUT,
    }));
    expect(response.output).toContainEqual(expect.objectContaining({
      type: "function_call",
      call_id: "call_function",
      name: FUNCTION_NAME,
      arguments: "{\"city\":\"Paris\"}",
    }));

    for (const customToolNames of [undefined, [], new Set()]) {
      const emptyResult = await handleForcedSSEToJson({ ...forcedContext(chatSse()), customToolNames });
      expect(emptyResult.success).toBe(true);
      const emptyResponse = await emptyResult.response.json();
      expect(emptyResponse.output.find((item) => item.call_id === "call_custom")?.type).toBe("function_call");
    }
  });

  it("passes native Responses custom items through untouched", async () => {
    const nativeItem = {
      type: "custom_tool_call",
      id: "ctc_native",
      call_id: "call_native",
      name: CUSTOM_NAME,
      input: RAW_INPUT,
    };
    const raw = [
      `event: response.created\ndata: ${JSON.stringify({ response: { id: "resp-native", created_at: 123 } })}\n\n`,
      `event: response.output_item.done\ndata: ${JSON.stringify({ output_index: 0, item: nativeItem })}\n\n`,
      `event: response.completed\ndata: ${JSON.stringify({ response: { status: "completed", usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 } } })}\n\n`,
    ].join("");

    const result = await handleForcedSSEToJson(forcedContext(raw, {
      targetFormat: FORMATS.OPENAI_RESPONSES,
      provider: "codex",
    }));
    expect(result.success).toBe(true);
    const response = await result.response.json();
    expect(response.output).toContainEqual(nativeItem);

    const codexFunctionItem = {
      type: "function_call",
      id: "fc_codex",
      call_id: "call_custom",
      name: CUSTOM_NAME,
      arguments: JSON.stringify({ input: RAW_INPUT }),
    };
    const codexRaw = [
      `event: response.created\ndata: ${JSON.stringify({ response: { id: "resp-codex", created_at: 123 } })}\n\n`,
      `event: response.output_item.done\ndata: ${JSON.stringify({ output_index: 0, item: codexFunctionItem })}\n\n`,
      `event: response.completed\ndata: ${JSON.stringify({ response: { status: "completed", usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 } } })}\n\n`,
    ].join("");
    const codexResult = await handleForcedSSEToJson(forcedContext(codexRaw, {
      sourceFormat: FORMATS.OPENAI_RESPONSE,
      targetFormat: FORMATS.OPENAI_RESPONSES,
      provider: "codex",
    }));
    expect(codexResult.success).toBe(true);
    const codexResponse = await codexResult.response.json();
    expect(codexResponse.output).toContainEqual(expect.objectContaining({
      type: "custom_tool_call",
      call_id: "call_custom",
      name: CUSTOM_NAME,
      input: RAW_INPUT,
    }));

    for (const customToolNames of [undefined, [], new Set()]) {
      const emptyResult = await handleForcedSSEToJson({
        ...forcedContext(codexRaw, {
          sourceFormat: FORMATS.OPENAI_RESPONSE,
          targetFormat: FORMATS.OPENAI_RESPONSES,
          provider: "codex",
        }),
        customToolNames,
      });
      expect(emptyResult.success).toBe(true);
      const emptyResponse = await emptyResult.response.json();
      expect(emptyResponse.output.find((item) => item.call_id === "call_custom")?.type).toBe("function_call");
    }
  });
});

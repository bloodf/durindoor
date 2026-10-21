import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { ROLE, CLAUDE_BLOCK, RESPONSES_ITEM } from "../../open-sse/translator/schema/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateRequest } from "../../open-sse/translator/index.js";

const execute = vi.hoisted(() => vi.fn());

// Keep external dispatch, persistence, diagnostics, and background refresh offline.
vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute }),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}),
  recordTokenSaverEvent: vi.fn(async () => {}),
}));
vi.mock("../../open-sse/handlers/chatCore/proxyTimeline.js", () => ({
  startTrace: () => null, record: vi.fn(), finishTrace: vi.fn(),
}));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
  }),
  maskSensitiveUrl: (url) => url,
}));
vi.mock("../../open-sse/utils/kimchiUserAgent.js", () => ({
  getKimchiUserAgent: () => "kimchi/offline-test",
  updateKimchiUserAgent: async () => "kimchi/offline-test",
}));

const { handleResponsesCore } = await import("../../open-sse/handlers/responsesHandler.js");

beforeEach(() => {
  execute.mockReset();
  execute.mockImplementation(async ({ body }) => ({
    response: new Response(JSON.stringify({ error: { message: "Offline dispatch sentinel" } }), {
      status: 502, headers: { "content-type": "application/json" },
    }),
    url: "https://example.invalid/cursor", headers: {}, transformedBody: body,
  }));
});

describe.each([false, true])("Cursor nested Responses output (stream=%s)", (stream) => {
  it.each([FORMATS.OPENAI, FORMATS.CURSOR])("classifies serialized tool blocks on %s registered input", (source) => {
    const text = "Literal example: data:image/png;base64,AAAA";
    const bodyFor = (block) => ({ stream, messages: [
      { role: ROLE.ASSISTANT, content: "", tool_calls: [
        { id: "call_1", type: "function", function: { name: "inspect", arguments: "{}" } },
      ] },
      { role: ROLE.TOOL, tool_call_id: "call_1", content: JSON.stringify([
        { type: CLAUDE_BLOCK.TOOL_RESULT, tool_use_id: "nested", content: [block] },
      ]) },
    ] });
    const textBody = bodyFor({ type: CLAUDE_BLOCK.TEXT, text });
    const out = translateRequest(source, FORMATS.CURSOR, "default", textBody, stream, null, "cursor");
    expect(JSON.stringify(out.messages)).toContain(text);
    const imageBody = bodyFor({ type: RESPONSES_ITEM.INPUT_IMAGE, image_url: "https://example.invalid/download/123" });
    const original = structuredClone(imageBody);
    expect(() => translateRequest(source, FORMATS.CURSOR, "default", imageBody, stream, null, "cursor"))
      .toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(imageBody).toEqual(original);
  });

  it.each([true, false])("distinguishes nested image blocks from text mentions (image=%s)", async (image) => {
    const text = "Literal example: data:image/png;base64,AAAA";
    const body = {
      model: "cursor/default", stream,
      input: [
        { type: RESPONSES_ITEM.MESSAGE, role: ROLE.USER, content: "inspect" },
        { type: RESPONSES_ITEM.FUNCTION_CALL, call_id: "call_1", name: "inspect", arguments: "{}" },
        { type: RESPONSES_ITEM.FUNCTION_CALL_OUTPUT, call_id: "call_1", output: [
          { type: CLAUDE_BLOCK.TOOL_RESULT, tool_use_id: "nested", content: [
            image
              ? { type: RESPONSES_ITEM.INPUT_IMAGE, image_url: "https://example.invalid/download/123" }
              : { type: CLAUDE_BLOCK.TEXT, text },
          ] },
        ] },
      ],
    };
    const original = structuredClone(body);
    const result = await handleResponsesCore({
      body, modelInfo: { provider: "cursor", model: "default" }, credentials: null,
    });
    if (image) {
      expect(result).toMatchObject({ success: false, status: 400 });
      expect(result.response.status).toBe(400);
      expect(await result.response.json()).toMatchObject({ error: {
        type: "invalid_request_error",
        message: expect.stringContaining("Cursor image input is not supported"),
      } });
      expect(execute).not.toHaveBeenCalled();
    } else {
      expect({ dispatched: execute.mock.calls.length, status: result.status, error: result.error })
        .toMatchObject({ dispatched: 1, status: 502 });
      expect(JSON.stringify(execute.mock.calls[0][0].body)).toContain(text);
      // The sentinel confirms validation allowed dispatch, not provider success.
      expect(result.status).toBe(502);
    }
    expect(body).toEqual(original);
  });
});

describe.each([false, true])("Cursor custom Responses output (stream=%s)", (stream) => {
  const imageBody = (provider) => ({
      model: `${provider}/default`, stream,
      input: [
        { type: RESPONSES_ITEM.MESSAGE, role: ROLE.USER, content: "inspect" },
        { type: RESPONSES_ITEM.CUSTOM_TOOL_CALL_OUTPUT, call_id: "call_1", output: [
          { type: CLAUDE_BLOCK.TOOL_RESULT, tool_use_id: "nested", content: [
            { type: RESPONSES_ITEM.INPUT_IMAGE, image_url: "https://example.invalid/download/123" },
          ] },
        ] },
      ],
  });

  it.each(["cursor", "cu"])("rejects %s typed images through registration", (provider) => {
    const body = imageBody(provider);
    const original = structuredClone(body);
    expect(() => translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.CURSOR, "default", body, stream, null, provider))
      .toThrow(expect.objectContaining({ statusCode: 400, message: expect.stringContaining("Cursor image input is not supported") }));
    expect(body).toEqual(original);
  });

  it.each(["cursor", "cu"])("rejects %s typed images through the Responses handler before dispatch", async (provider) => {
    const body = imageBody(provider);
    const original = structuredClone(body);

    const result = await handleResponsesCore({ body, modelInfo: { provider, model: "default" }, credentials: null });
    expect(result).toMatchObject({ success: false, status: 400 });
    expect(result.response.status).toBe(400);
    expect(await result.response.json()).toMatchObject({ error: {
      type: "invalid_request_error", message: expect.stringContaining("Cursor image input is not supported"),
    } });
    expect(execute).not.toHaveBeenCalled();
    expect(body).toEqual(original);
  });

  it.each(["cursor", "cu"])("allows %s ordinary custom tool JSON mentioning images", async (provider) => {
    const body = {
      model: `${provider}/default`, stream,
      input: [
        { type: RESPONSES_ITEM.MESSAGE, role: ROLE.USER, content: "inspect" },
        { type: RESPONSES_ITEM.CUSTOM_TOOL_CALL_OUTPUT, call_id: "call_1", output: {
          type: "image", image_url: "https://example.invalid/photo.png",
        } },
      ],
    };
    const original = structuredClone(body);
    const translated = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.CURSOR, "default", structuredClone(body), stream, null, provider);
    expect(translated.messages).toEqual([{ role: ROLE.USER, content: "inspect" }]);
    expect(body).toEqual(original);

    const result = await handleResponsesCore({ body, modelInfo: { provider, model: "default" }, credentials: null });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(502);
    expect(body).toEqual(original);
  });
});

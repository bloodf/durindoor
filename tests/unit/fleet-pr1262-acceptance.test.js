import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { ROLE, OPENAI_BLOCK, CLAUDE_BLOCK, RESPONSES_ITEM } from "../../open-sse/translator/schema/index.js";
import { translateRequest } from "../../open-sse/translator/index.js";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));

// Keep dispatch, diagnostics, persistence, and background UA refresh offline.
// Validation, registration, Responses conversion, and HTTP errors stay real.
vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: mocks.execute }),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
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

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { handleResponsesCore } = await import("../../open-sse/handlers/responsesHandler.js");

beforeEach(() => {
  vi.clearAllMocks();
  // A deterministic offline sentinel makes accidental dispatch observable.
  mocks.execute.mockImplementation(async ({ body }) => ({
    response: new Response(JSON.stringify({ error: { message: "Unexpected offline provider dispatch" } }), {
      status: 502, headers: { "content-type": "application/json" },
    }),
    url: "https://example.invalid/cursor", headers: {}, transformedBody: body,
  }));
});

describe.each([false, true])("PR #1262 registered acceptance (stream=%s)", (stream) => {
  it("replays the original Cursor image row as an explicit unsupported-input error", () => {
    const body = { messages: [{ role: ROLE.USER, content: [
      { type: OPENAI_BLOCK.TEXT, text: "look" },
      { type: OPENAI_BLOCK.IMAGE_URL, image_url: { url: "data:image/png;base64,AAAA" } },
    ] }] };
    const original = structuredClone(body);
    expect(() => translateRequest(FORMATS.OPENAI, FORMATS.CURSOR, "m", body, stream, null, "cursor"))
      .toThrow(expect.objectContaining({ statusCode: 400, message: expect.stringContaining("use a vision-capable provider") }));
    expect(body).toEqual(original);
  });

  it.each([
    [FORMATS.CLAUDE, { messages: [{ role: ROLE.USER, content: [
      { type: CLAUDE_BLOCK.TOOL_RESULT, tool_use_id: "orphan", content: [
        { type: CLAUDE_BLOCK.IMAGE, source: { type: "base64", media_type: "image/png", data: "AAAA" } },
      ] },
    ] }] }],
    [FORMATS.GEMINI, { contents: [{ role: ROLE.USER, parts: [
      { inlineData: { mimeType: "image/png", data: "AAAA" } },
    ] }] }],
    [FORMATS.ANTIGRAVITY, { request: { contents: [{ role: ROLE.USER, parts: [
      { fileData: { mimeType: "image/png", fileUri: "https://example.invalid/download/123" } },
    ] }] } }],
  ])("rejects %s source images through registration before source normalization", (source, body) => {
    const original = structuredClone(body);
    expect(() => translateRequest(source, FORMATS.CURSOR, "m", body, stream, null, "cursor", null, ["image"]))
      .toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(body).toEqual(original);
  });

  it.each([
    [FORMATS.CLAUDE, { messages: [{ role: ROLE.USER, content: [{ type: CLAUDE_BLOCK.TEXT, text: "read report" }] }] }],
    [FORMATS.GEMINI, { contents: [{ role: ROLE.USER, parts: [{ text: "read report" }] }] }],
  ])("preserves supported %s text through the registered pivot", (source, body) => {
    const out = translateRequest(source, FORMATS.CURSOR, "m", body, stream, null, "cursor");
    expect(out.messages).toEqual([{ role: ROLE.USER, content: "read report" }]);
  });

  it.each(["cursor", "cu"])("returns client-visible JSON 400 for %s before compression or dispatch", async (provider) => {
    const body = { stream, messages: [{ role: ROLE.USER, content: [
      { type: OPENAI_BLOCK.IMAGE_URL, image_url: { url: "https://example.invalid/download/123" } },
    ] }] };
    const original = structuredClone(body);
    const result = await handleChatCore({
      body, modelInfo: { provider, model: "default" }, credentials: null,
      sourceFormatOverride: FORMATS.CURSOR, rtkEnabled: true, headroomEnabled: true,
      headroomUrl: "https://example.invalid/compress", compressionEnabled: true,
    });
    expect(result).toMatchObject({ success: false, status: 400 });
    expect(result.response.status).toBe(400);
    expect(result.response.headers.get("content-type")).toContain("application/json");
    expect(await result.response.json()).toMatchObject({ error: {
      type: "invalid_request_error", message: expect.stringContaining("Remove images"),
    } });
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(body).toEqual(original);
  });
});

describe.each([false, true])("PR #1262 Responses runtime (stream=%s)", (stream) => {
  it.each(["cursor", "cu"])("allows %s ordinary tool-output JSON mentioning images to reach dispatch", async (provider) => {
    const output = { type: "image", image_url: "https://example.invalid/photo.png" };
    const body = {
      model: "cursor/default", stream,
      input: [
        { type: RESPONSES_ITEM.MESSAGE, role: ROLE.USER, content: "inspect" },
        { type: RESPONSES_ITEM.FUNCTION_CALL, call_id: "call_1", name: "inspect", arguments: "{}" },
        { type: RESPONSES_ITEM.FUNCTION_CALL_OUTPUT, call_id: "call_1", output },
      ],
    };
    const original = structuredClone(body);
    const result = await handleResponsesCore({
      body, modelInfo: { provider, model: "default" }, credentials: null,
    });
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.execute.mock.calls[0][0].body)).toContain("photo.png");
    // The offline sentinel proves the request passed validation, not provider success.
    expect(result.status).toBe(502);
    expect(body).toEqual(original);
  });

  it("does not apply Cursor image restrictions to a vision-capable provider", async () => {
    const body = { model: "gpt-4o", stream, input: [
      { type: RESPONSES_ITEM.MESSAGE, role: ROLE.USER, content: [
        { type: RESPONSES_ITEM.INPUT_IMAGE, image_url: "data:image/png;base64,AAAA" },
      ] },
    ] };
    const original = structuredClone(body);
    const result = await handleResponsesCore({
      body, modelInfo: { provider: "openai", model: "gpt-4o" }, credentials: null,
    });
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0][0].body.messages[0].content).toEqual([
      { type: OPENAI_BLOCK.IMAGE_URL, image_url: { url: "data:image/png;base64,AAAA", detail: "auto" } },
    ]);
    expect(result.status).toBe(502);
    expect(body).toEqual(original);
  });

  it.each(["cursor", "cu"])("rejects %s typed tool-output images before Responses conversion erases their shape", async (provider) => {
    const body = {
      model: "cursor/default", stream,
      input: [
        { type: RESPONSES_ITEM.MESSAGE, role: ROLE.USER, content: "inspect" },
        { type: RESPONSES_ITEM.FUNCTION_CALL, call_id: "call_1", name: "inspect", arguments: "{}" },
        { type: RESPONSES_ITEM.FUNCTION_CALL_OUTPUT, call_id: "call_1", output: [
          { type: RESPONSES_ITEM.INPUT_IMAGE, image_url: "https://example.invalid/download/123" },
        ] },
      ],
    };
    const original = structuredClone(body);
    const result = await handleResponsesCore({
      body, modelInfo: { provider, model: "default" }, credentials: null,
    });
    expect({ status: result.status, dispatched: mocks.execute.mock.calls.length })
      .toEqual({ status: 400, dispatched: 0 });
    expect(result.response.status).toBe(400);
    expect(await result.response.json()).toMatchObject({ error: {
      type: "invalid_request_error",
      message: expect.stringContaining("Cursor image input is not supported"),
    } });
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(body).toEqual(original);
  });
});

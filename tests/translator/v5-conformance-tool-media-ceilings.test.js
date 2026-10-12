import { beforeEach, describe, expect, it, vi } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { OPENAI_BLOCK, ROLE } from "../../open-sse/translator/schema/index.js";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../open-sse/executors/index.js", () => ({ getExecutor: () => ({ noAuth: true, execute: mocks.execute }) }));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}), recordTokenSaverEvent: vi.fn(async () => {}),
}));
vi.mock("../../open-sse/handlers/chatCore/proxyTimeline.js", () => ({ startTrace: () => null, record: vi.fn(), finishTrace: vi.fn() }));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
  }), maskSensitiveUrl: (url) => url,
}));
vi.mock("../../open-sse/utils/kimchiUserAgent.js", () => ({
  getKimchiUserAgent: () => "kimchi/offline-test", updateKimchiUserAgent: async () => "kimchi/offline-test",
}));
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
beforeEach(() => {
  vi.clearAllMocks();
  mocks.execute.mockImplementation(async ({ body }) => ({
    response: new Response(JSON.stringify({ error: { message: "Offline dispatch sentinel" } }), {
      status: 502, headers: { "content-type": "application/json" },
    }), url: "https://example.invalid/offline", headers: {}, transformedBody: body,
  }));
});

// Issue #1089: unsupported typed output fails closed before dispatch; supported
// text and native Responses media remain usable. No universal numeric ceiling.
const schema = { type: "object", properties: { q: { type: "string" } }, required: ["q"] };
const chat = (extra = {}) => ({
  messages: [{ role: ROLE.USER, content: "hi" }],
  tools: [{ type: OPENAI_BLOCK.FUNCTION, function: { name: "search", parameters: schema, strict: true } }],
  ...extra,
});

describe("#1089 T5 Gemini strictness", () => {
  it("delivers the schema to Gemini without an OpenAI strict field", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.GEMINI, "gemini-test", chat(), false);
    const declaration = out.tools[0].functionDeclarations[0];
    expect(declaration.name).toBe("search");
    expect(declaration.parameters.properties.q).toMatchObject({ type: expect.stringMatching(/string/i) });
    expect(JSON.stringify(out.tools)).not.toContain("\"strict\"");
  });
});

describe("#1089 T8 numeric call ceilings", () => {
  it("does not turn max_tool_calls into a boolean Claude parallel ban", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-4-5", chat({ max_tool_calls: 1 }), false);
    expect(out.tool_choice?.disable_parallel_tool_use).not.toBe(true);
    expect(out).not.toHaveProperty("max_tool_calls");
  });
});

describe("#1089 T12 tool-result audio and documents", () => {
  const bodyFor = (output) => ({ stream: false, input: [
    { type: "function_call", call_id: "c1", name: "fetch", arguments: "{}" },
    { type: "function_call_output", call_id: "c1", output },
  ] });
  const gateway = (output, provider = "openai", model = "gpt-4o") => handleChatCore({
    body: bodyFor(output), modelInfo: { provider, model }, credentials: null,
    sourceFormatOverride: FORMATS.OPENAI_RESPONSES,
  });

  it.each([
    { type: "input_file", file_id: "file-report-1" },
    { type: "input_audio", input_audio: { data: "QUJD", format: "wav" } },
    { type: "input_text", text: 123 },
    { type: "output_text" },
    null,
  ])("returns HTTP 400 with zero dispatch for unsupported/malformed tool output %j", async (part) => {
    const result = await gateway([{ type: "input_text", text: "report" }, part]);
    expect(result.status).toBe(400);
    expect(result.response.status).toBe(400);
    expect(await result.response.json()).toMatchObject({ error: {
      type: "invalid_request_error", message: expect.stringContaining("UNSUPPORTED_TOOL_OUTPUT"),
    } });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("dispatches supported text with exact content fidelity", async () => {
    const result = await gateway([{ type: "input_text", text: "report" }, { type: "output_text", text: "summary" }]);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0][0].body.messages.find((message) => message.role === ROLE.TOOL).content).toBe("report\nsummary");
    expect(result.status).toBe(502);
  });

  it("dispatches supported lifted image media instead of serializing its bytes", async () => {
    const url = "https://example.invalid/report.png";
    const result = await gateway([{ type: "input_text", text: "report" }, { type: "input_image", image_url: url }]);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0][0].body.messages.at(-1).content).toEqual([
      { type: OPENAI_BLOCK.IMAGE_URL, image_url: { url, detail: "auto" } },
    ]);
    expect(result.status).toBe(502);
  });

  it("keeps legal native Responses media untouched through gateway dispatch", async () => {
    const output = [{ type: "input_image", image_url: "https://example.invalid/report.png" }];
    const result = await gateway(output, "codex", "gpt-5-codex");
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0][0].body.input.find((item) => item.type === "function_call_output").output).toEqual(output);
    expect(result.status).toBe(502);
  });

  it("does not silently drop a Claude tool_result document that sits beside text", () => {
    const doc = { type: "document", source: { type: "url", url: "https://example.test/report.pdf" } };
    const out = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "m", {
      max_tokens: 100,
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "fetch", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: [{ type: "text", text: "see report" }, doc] }] },
      ],
    }, false, null, null);
    expect(JSON.stringify(out.messages)).toContain("report.pdf");
  });
});

// Trust boundary of the nested-document branch in request/claude-to-openai.js: a
// non-URL source is an explicit client error, a non-http(s) URI never reaches the
// upstream, and a real http(s) URI is forwarded whole — no truncation, no invented
// document contents. Driven through the registered CLAUDE->OPENAI flow, no mocks.
describe("#1089 T12 nested document source boundary", () => {
  const nested = (doc) =>
    translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "m", {
      max_tokens: 100,
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "fetch", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: [{ type: "text", text: "see report" }, doc] }] },
      ],
    }, false, null, null);
  const toolContent = (out) => out.messages.find((m) => m.role === ROLE.TOOL).content;
  // Captures the thrown error without wrapping: the public 4xx contract is the
  // statusCode the handler reads, not just the message text.
  const rejection = (doc) => {
    try {
      nested(doc);
    } catch (error) {
      return error;
    }
    return null;
  };

  const nonUrlSources = [
    { type: "base64", media_type: "application/pdf", data: "JVBERi0xLjQK" },
    { type: "text", media_type: "text/plain", data: "plain report body" },
    { type: "content", content: [{ type: "text", text: "report body" }] },
  ];

  it.each(nonUrlSources)("rejects a non-URL document source ($type) with an explicit 400", (source) => {
    const error = rejection({ type: "document", source });
    expect(error).toBeInstanceOf(Error);
    expect(error.statusCode).toBe(400);
    expect(error.message).toContain("UNSUPPORTED_DOCUMENT");
    expect(error.message).toContain(source.type);
  });

  it.each([
    "data:application/pdf;base64,JVBERi0xLjQK",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "ftp://example.test/report.pdf",
    "example.test/report.pdf",
  ])("rejects the non-http(s) document URI %s instead of forwarding it", (url) => {
    const error = rejection({ type: "document", source: { type: "url", url } });
    expect(error).toBeInstanceOf(Error);
    expect(error.statusCode).toBe(400);
    expect(error.message).toContain("UNSUPPORTED_DOCUMENT");
  });

  it("keeps a long https document URI verbatim, untruncated and unfabricated", () => {
    // Well past 100 characters, so a truncated or elided URI fails here.
    const url =
      "https://files.example.test/reports/2026/q3/quarterly-financial-summary-and-appendix-" +
      "a1b2c3d4e5f60718293a4b5c6d7e8f90-final-v7.pdf?download=1&token=abcdefghijklmnop";
    expect(url.length).toBeGreaterThan(100);
    const content = toolContent(nested({ type: "document", source: { type: "url", url } }));
    expect(content).toContain("see report");
    expect(content).toContain(url);
    // The document was never opened, so no body may be invented for it.
    expect(content).not.toMatch(/extracted|page \d|based on the document/i);
  });

  it("keeps the text sibling when a valid https document rides alongside it", () => {
    const url = "https://example.test/report.pdf";
    const lines = toolContent(
      nested({ type: "document", source: { type: "url", url } }),
    ).split("\n");
    // Sibling text first, then exactly one line naming the document URI.
    expect(lines[0]).toBe("see report");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(url);
  });
});

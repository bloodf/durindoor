import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { OPENAI_BLOCK, ROLE } from "../../open-sse/translator/schema/index.js";

// Issue #1089 rows T5, T8 (numeric), T12 (audio/documents). Ordinary assertions from a static
// trace; none has been run. The contract under test is "supported or explicitly rejected, never
// silently lost". Where the repo defines no ceiling or strict contract, the assertion is that
// nothing is fabricated.
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
  const responses = (output) => translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "m", {
    input: [
      { type: "function_call", call_id: "c1", name: "fetch", arguments: "{}" },
      { type: "function_call_output", call_id: "c1", output },
    ],
  }, false, null, null);
  const toolContent = (out) => out.messages.find((m) => m.role === ROLE.TOOL).content;

  it("keeps a Responses tool-output file reference visible to the upstream", () => {
    const content = toolContent(responses([{ type: "input_text", text: "report" }, { type: "input_file", file_id: "file-report-1" }]));
    expect(content).toContain("report");
    expect(content).toContain("file-report-1");
  });

  it("keeps a Responses tool-output audio part visible to the upstream", () => {
    const content = toolContent(responses([{ type: "input_audio", input_audio: { data: "QUJD", format: "wav" } }]));
    expect(content).toContain("input_audio");
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

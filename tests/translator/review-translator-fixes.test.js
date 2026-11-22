import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { CLAUDE_BLOCK, OPENAI_BLOCK, ROLE } from "../../open-sse/translator/schema/index.js";

describe("#2184 Chat -> Responses joins all non-empty system/developer instructions", () => {
  const toResponses = (messages) =>
    translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "gpt-5", { messages }, false);

  it("joins multiple system and developer messages with newlines in order", () => {
    const out = toResponses([
      { role: ROLE.SYSTEM, content: "First system rule." },
      { role: ROLE.USER, content: "Hello" },
      { role: ROLE.DEVELOPER, content: "Developer rule." },
      { role: ROLE.SYSTEM, content: [{ type: OPENAI_BLOCK.TEXT, text: "Array part 1" }, { type: OPENAI_BLOCK.TEXT, text: "Array part 2" }] }
    ]);

    expect(out.instructions).toBe("First system rule.\nDeveloper rule.\nArray part 1\nArray part 2");
    expect(out.input).toEqual([
      { type: "message", role: ROLE.USER, content: [{ type: "input_text", text: "Hello" }] }
    ]);
  });

  it("skips empty system/developer messages and preserves subsequent non-empty ones", () => {
    const out = toResponses([
      { role: ROLE.SYSTEM, content: "" },
      { role: ROLE.DEVELOPER, content: null },
      { role: ROLE.SYSTEM, content: [{ type: OPENAI_BLOCK.TEXT, text: "" }] },
      { role: ROLE.DEVELOPER, content: "Keep this instruction." },
      { role: ROLE.SYSTEM, content: "" },
      { role: ROLE.SYSTEM, content: "And this one." },
      { role: ROLE.USER, content: "Hi" }
    ]);

    expect(out.instructions).toBe("Keep this instruction.\nAnd this one.");
  });

  it("leaves instructions empty when no non-empty system/developer messages exist", () => {
    const out = toResponses([
      { role: ROLE.SYSTEM, content: "" },
      { role: ROLE.USER, content: "Hi" }
    ]);

    expect(out.instructions).toBe("");
  });
});

describe("#2185 Gemini -> OpenAI fileData and functionResponse translation", () => {
  const toOpenAI = (contents, sourceFormat = FORMATS.GEMINI) =>
    translateRequest(sourceFormat, FORMATS.OPENAI, "gemini-2.5-pro", { contents }, false);

  it("translates fileData into an OpenAI image_url part using fileUri", () => {
    const uri = "https://example.com/photo.png";
    const out = toOpenAI([
      {
        role: "user",
        parts: [
          { text: "Describe this image" },
          { fileData: { mimeType: "image/png", fileUri: uri } }
        ]
      }
    ]);

    expect(out.messages).toEqual([
      {
        role: ROLE.USER,
        content: [
          { type: OPENAI_BLOCK.TEXT, text: "Describe this image" },
          { type: OPENAI_BLOCK.IMAGE_URL, image_url: { url: uri } }
        ]
      }
    ]);
  });

  it("handles standalone fileData and ignores fileData without fileUri", () => {
    const uri = "gs://bucket/doc.png";
    const out = toOpenAI([
      {
        role: "user",
        parts: [
          { fileData: { mimeType: "image/png", fileUri: uri } },
          { fileData: { mimeType: "image/png" } },
          { fileData: { mimeType: "image/png", fileUri: "" } }
        ]
      }
    ]);

    expect(out.messages).toEqual([
      {
        role: ROLE.USER,
        content: [{ type: OPENAI_BLOCK.IMAGE_URL, image_url: { url: uri } }]
      }
    ]);
  });

  it.each([
    ["plain string result", { result: "plain text output" }, "plain text output"],
    ["empty string result", { result: "" }, ""],
    ["numeric zero result", { result: 0 }, "0"],
    ["boolean false result", { result: false }, "false"],
    ["null result", { result: null }, "null"],
    ["object result", { result: { ok: true, count: 2 } }, '{"ok":true,"count":2}'],
    ["array result", { result: [1, "two"] }, '[1,"two"]'],
    ["response without result key", { status: "ok", items: [1] }, '{"status":"ok","items":[1]}'],
    ["missing response", undefined, "{}"]
  ])("formats functionResponse tool content for %s", (_label, response, expectedContent) => {
    const out = toOpenAI([
      { role: "model", parts: [{ functionCall: { id: "call_1", name: "lookup", args: {} } }] },
      { role: "user", parts: [{ functionResponse: { id: "call_1", name: "lookup", response } }] }
    ]);

    const toolMsg = out.messages.find((m) => m.role === ROLE.TOOL);
    expect(toolMsg).toEqual({
      role: ROLE.TOOL,
      tool_call_id: "call_1",
      content: expectedContent
    });
  });

  it("applies the same fileData and functionResponse fixes for GEMINI_CLI", () => {
    const out = toOpenAI(
      [
        { role: "user", parts: [{ fileData: { fileUri: "https://example.com/cli.png", mimeType: "image/png" } }] },
        { role: "model", parts: [{ functionCall: { id: "call_cli", name: "ping", args: {} } }] },
        { role: "user", parts: [{ functionResponse: { id: "call_cli", name: "ping", response: { result: "pong" } } }] }
      ],
      FORMATS.GEMINI_CLI
    );

    expect(out.messages[0].content).toEqual([
      { type: OPENAI_BLOCK.IMAGE_URL, image_url: { url: "https://example.com/cli.png" } }
    ]);
    expect(out.messages.find((m) => m.role === ROLE.TOOL)?.content).toBe("pong");
  });
});

describe("#2186 OpenAI -> Claude skips image_url parts without a url", () => {
  const toClaude = (messages) =>
    translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-4-5", { messages }, false);

  it("skips malformed image_url parts in user messages without throwing and preserves valid parts", () => {
    const validUrl = "https://example.com/valid.png";
    const out = toClaude([
      {
        role: ROLE.USER,
        content: [
          { type: OPENAI_BLOCK.TEXT, text: "Before" },
          { type: OPENAI_BLOCK.IMAGE_URL },
          { type: OPENAI_BLOCK.IMAGE_URL, image_url: null },
          { type: OPENAI_BLOCK.IMAGE_URL, image_url: {} },
          { type: OPENAI_BLOCK.IMAGE_URL, image_url: { url: undefined } },
          { type: OPENAI_BLOCK.IMAGE_URL, image_url: { url: null } },
          { type: OPENAI_BLOCK.IMAGE_URL, image_url: { url: "" } },
          { type: OPENAI_BLOCK.IMAGE_URL, image_url: { url: validUrl } },
          { type: OPENAI_BLOCK.TEXT, text: "After" }
        ]
      }
    ]);

    expect(out.messages).toEqual([
      {
        role: ROLE.USER,
        content: [
          { type: CLAUDE_BLOCK.TEXT, text: "Before" },
          { type: CLAUDE_BLOCK.IMAGE, source: { type: "url", url: validUrl } },
          { type: CLAUDE_BLOCK.TEXT, text: "After" }
        ]
      }
    ]);
  });

  it("does not throw when a user message contains only an image_url part without a url", () => {
    const out = toClaude([
      { role: ROLE.USER, content: [{ type: OPENAI_BLOCK.IMAGE_URL, image_url: {} }] }
    ]);

    expect(out.messages).toEqual([]);
  });

  it("skips malformed image_url parts inside tool messages without throwing", () => {
    const out = toClaude([
      { role: ROLE.USER, content: "Run tool" },
      {
        role: ROLE.ASSISTANT,
        content: null,
        tool_calls: [{ id: "call_1", type: OPENAI_BLOCK.FUNCTION, function: { name: "snap", arguments: "{}" } }]
      },
      {
        role: ROLE.TOOL,
        tool_call_id: "call_1",
        content: [
          { type: OPENAI_BLOCK.TEXT, text: "ok" },
          { type: OPENAI_BLOCK.IMAGE_URL },
          { type: OPENAI_BLOCK.IMAGE_URL, image_url: {} }
        ]
      }
    ]);

    const toolResult = out.messages
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .find((b) => b.type === CLAUDE_BLOCK.TOOL_RESULT);
    expect(toolResult.content).toEqual([{ type: CLAUDE_BLOCK.TEXT, text: "ok" }]);
  });
});

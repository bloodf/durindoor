// OpenAI → Gemini / Cursor / CommandCode request translation.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { openaiToCursorRequest, validateCursorImages } from "../../open-sse/translator/request/openai-to-cursor.js";

const O2G = (body) => translateRequest(FORMATS.OPENAI, FORMATS.GEMINI, "m", body, true, null, "gemini");
const O2C = (body) => translateRequest(FORMATS.OPENAI, FORMATS.CURSOR, "m", body, true, null, "cursor");
const O2CC = (body) => translateRequest(FORMATS.OPENAI, FORMATS.COMMANDCODE, "m", body, true, null, "commandcode");

describe("OpenAI → Gemini", () => {
  // openai-to-gemini.js:92-96 — each system message overwrites systemInstruction → only last kept
  // KNOWN BUG
  it.fails("multiple system messages are all kept", () => {
    const out = O2G({
      messages: [
        { role: "system", content: "RULE_ONE" },
        { role: "system", content: "RULE_TWO" },
        { role: "user", content: "hi" },
      ],
    });
    expect(JSON.stringify(out.systemInstruction), "earlier system lost").toContain("RULE_ONE");
  });
});

describe("OpenAI → Cursor", () => {
  describe.each([false, true])("image handling (stream=%s)", (stream) => {
    const routes = [
      ["direct", (body) => openaiToCursorRequest("m", body, stream, null)],
      ["translated", (body) => translateRequest(FORMATS.OPENAI, FORMATS.CURSOR, "m", body, stream, null, "cursor")],
      ["same-format", (body) => translateRequest(FORMATS.CURSOR, FORMATS.CURSOR, "m", body, stream, null, "cursor")],
      ["explicit strip", (body) => translateRequest(FORMATS.OPENAI, FORMATS.CURSOR, "m", body, stream, null, "cursor", null, ["image"])],
    ];

    describe.each(routes)("%s", (_name, translate) => {
      it.each([
        { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
        { type: "image_url", image_url: { url: "https://example.invalid/photo.png" } },
        { type: "image_url", image_url: { url: "https://example.invalid/download/123" } },
        { type: "image", source: { type: "url", url: "https://example.invalid/download/123" } },
        { type: "input_image", image_url: "https://example.invalid/download/123" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
      ])("rejects unsupported images with 400 without mutating input: %j", (image) => {
        const body = { stream, messages: [{ role: "user", content: [
          { type: "text", text: "look" }, image,
        ] }] };
        const original = structuredClone(body);
        expect(() => translate(body)).toThrow(expect.objectContaining({
          statusCode: 400,
          message: expect.stringContaining("Cursor image input is not supported"),
        }));
        expect(body).toEqual(original);
      });

      it.each([
        { images: ["AAAA"] },
        { image: "data:image/png;base64,AAAA" },
        { image_url: { url: "https://example.invalid/photo.png" } },
        { image_url: { url: "https://example.invalid/download/123" } },
        { image_url: "https://example.invalid/download/123" },
        ...["attachments", "experimental_attachments"].flatMap((field) => [
          { [field]: [{ contentType: "image/png", url: "https://example.invalid/photo.png" }] },
          { [field]: [{ mediaType: "image/png", data: "AAAA" }] },
          { [field]: [{ url: "data:image/png;base64,AAAA" }] },
          { [field]: [{ url: "https://example.invalid/photo.png" }] },
          { [field]: [{ url: "https://example.invalid/photo.JPG?download=1#preview" }] },
          { [field]: [{ contentType: "image/png", url: "https://example.invalid/download/123" }] },
        ]),
      ])("rejects message-level images before stripping without mutation: %j", (fields) => {
        const body = { stream, messages: [{ role: "user", content: "look", ...fields }] };
        const original = structuredClone(body);
        expect(() => translate(body)).toThrow(expect.objectContaining({ statusCode: 400 }));
        expect(body).toEqual(original);
      });

      it.each([
        "![photo](data:image/png;base64,AAAA)",
        "data:image/png;base64,AAAA",
        "look: DATA:IMAGE/PNG;BASE64,AAAA",
        "![photo](data:image/svg+xml,%3Csvg%3E)",
        "data:text/plain,hello data:image/png;base64,AAAA",
      ])("rejects inline image data before stripping without mutation: %s", (content) => {
        const body = { stream, messages: [{ role: "user", content }] };
        const original = structuredClone(body);
        expect(() => translate(body)).toThrow(expect.objectContaining({
          statusCode: 400,
          message: expect.stringContaining("Cursor image input is not supported"),
        }));
        expect(body).toEqual(original);
      });

      it.each([
        "Explain image/png and base64 image data URLs.",
        "![photo](https://example.invalid/photo.png)",
        "data:image/png;base64",
        "data:image/png;base64,",
        "![photo](data:image/png;base64,)",
        "data:image/png;base64, AAAA",
        "data:image/png;charset=utf-8;base64,AAAA",
        "data:text/plain;base64,AAAA",
        "data:application/x-image/png;base64,AAAA",
      ])("preserves ordinary text not recognized as inline image data: %s", (content) => {
        const body = { stream, messages: [{ role: "user", content }] };
        const original = structuredClone(body);
        expect(translate(body).messages).toEqual([{ role: "user", content }]);
        expect(body).toEqual(original);
      });

      it("preserves data URL mentions inside text blocks that the inline stripper does not scan", () => {
        const content = "Example: data:image/png;base64,AAAA";
        const body = { stream, messages: [{ role: "user", content: [{ type: "text", text: content }] }] };
        const original = structuredClone(body);
        const out = translate(body);
        expect(out.messages).toEqual(_name === "same-format"
          ? original.messages
          : [{ role: "user", content }]);
        expect(body).toEqual(original);
      });

      it("preserves text and tool history without images", () => {
        const toolCall = { id: "call_1", type: "function", function: { name: "inspect", arguments: '{"image":"filename.png"}' } };
        const body = { stream, messages: [
          { role: "user", content: "inspect filename.png" },
          { role: "assistant", content: "checking", tool_calls: [toolCall] },
          { role: "tool", tool_call_id: "call_1", content: "found <entry>" },
        ] };
        const out = translate(body);
        expect(out.messages[0]).toEqual({ role: "user", content: "inspect filename.png" });
        expect(out.messages[1]).toMatchObject({ role: "assistant", content: "checking", tool_calls: [toolCall] });
        if (_name === "same-format") {
          expect(out.messages[2]).toEqual({ role: "tool", tool_call_id: "call_1", content: "found <entry>" });
        } else {
          expect(out.messages[2]).toEqual({ role: "user", content: [
            "<tool_result>", "<tool_name>inspect</tool_name>",
            "<tool_call_id>call_1</tool_call_id>", "<result>found &lt;entry&gt;</result>", "</tool_result>",
          ].join("\n") });
        }
      });
    });
  });

  describe.each([false, true])("Responses output images (stream=%s)", (stream) => {
    it.each([false, true])("rejects typed output images before orphan cleanup (matched=%s)", (matched) => {
      const body = { stream, input: [
        ...(matched ? [{ type: "function_call", call_id: "call_1", name: "inspect", arguments: "{}" }] : []),
        { type: "function_call_output", call_id: "call_1", output: [
          { type: "input_text", text: "look" },
          { type: "input_image", image_url: "data:image/png;base64,AAAA" },
        ] },
      ] };
      const original = structuredClone(body);
      expect(() => translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.CURSOR, "m", body, stream, null, "cursor", null, ["image"]))
        .toThrow(expect.objectContaining({ statusCode: 400 }));
      expect(body).toEqual(original);
    });
  });

  it.each([
    { images: [] },
    { images: [null, "", {}, []], image: {}, image_url: { url: "" } },
    { images: null, image: "", image_url: [] },
    { attachments: [], experimental_attachments: [] },
    ...["attachments", "experimental_attachments"].flatMap((field) => [
      { [field]: [{ url: "https://example.invalid/report.pdf" }] },
      { [field]: [{ url: "https://example.invalid/download/123" }] },
      { [field]: [{ url: "https://example.invalid/download?name=photo.png" }] },
      { [field]: [{ data: "AAAA" }] },
      { [field]: [{ contentType: "application/pdf", url: "https://example.invalid/photo.png" }] },
    ]),
  ])("accepts empty image containers and attachments without image evidence: %j", (fields) => {
    const body = { messages: [{ role: "user", content: "read report", ...fields }] };
    const original = structuredClone(body);
    const out = openaiToCursorRequest("m", body, false, null);
    expect(out.messages).toEqual([{ role: "user", content: "read report" }]);
    expect(body).toEqual(original);
  });

  it("leaves arbitrary tool JSON, schemas, and non-image attachments untouched", () => {
    const data = { type: "image", content: [{ type: "image" }], parts: [{ type: "input_image" }] };
    const body = {
      tools: [{ type: "function", function: { name: "inspect", parameters: data } }],
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "inspect", input: data }],
          tool_calls: [{ id: "call_2", type: "function", function: { name: "inspect", arguments: JSON.stringify(data) } }] },
        { role: "tool", tool_call_id: "call_2", content: data },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: data }],
          attachments: [{ contentType: "application/pdf", url: "https://example.invalid/file.pdf" }],
          experimental_attachments: [{ url: "data:text/plain;base64,AAAA" }] },
      ],
      input: [
        { type: "function_call_output", call_id: "call_3", output: data },
        { type: "function_call_output", call_id: "call_4", output: [
          { type: "input_text", text: JSON.stringify(data), content: data.content, parts: data.parts },
        ] },
        { type: "function_call", call_id: "call_5", name: "inspect", arguments: JSON.stringify(data) },
      ],
      contents: [{ role: "user", parts: [{ functionResponse: { name: "inspect", response: data } }] }],
    };
    const original = structuredClone(body);
    validateCursorImages(body);
    expect(body).toEqual(original);
  });

  it.each([
    { messages: [{ role: "user", content: [{ type: "image", source: { type: "url", url: "https://example.invalid/photo.png" } }] }] },
    { messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "orphan", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }] }] }] },
    { input: [{ role: "user", content: [{ type: "input_image", image_url: "data:image/png;base64,AAAA" }] }] },
    { contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/png", data: "AAAA" } }] }] },
    { request: { contents: [{ role: "user", parts: [{ fileData: { mimeType: "image/png", fileUri: "https://example.invalid/photo.png" } }] }] } },
  ])("rejects source images before stripping or orphan salvage: %j", (body) => {
    const original = structuredClone(body);
    expect(() => validateCursorImages(body)).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(body).toEqual(original);
  });

  // openai-to-cursor.js:179 — max_tokens hardcoded to 32000
  // KNOWN BUG
  it.fails("respects client max_tokens", () => {
    const out = O2C({ max_tokens: 200, messages: [{ role: "user", content: "hi" }] });
    expect(out.max_tokens).toBe(200);
  });
});

describe("OpenAI → CommandCode", () => {
  it("malformed tool arguments are not silently emptied", () => {
    expect(() => O2CC({
      messages: [
        { role: "user", content: "go" },
        { role: "assistant", content: "", tool_calls: [
          { id: "c1", type: "function", function: { name: "f", arguments: "{bad" } },
        ] },
        { role: "tool", tool_call_id: "c1", content: "r" },
      ],
    })).toThrow("invalid arguments");
  });

  it("image content is preserved", () => {
    const out = O2CC({
      messages: [{ role: "user", content: [
        { type: "text", text: "look" },
        { type: "image_url", image_url: { url: "data:image/png;base64,BBBB" } },
      ] }],
    });
    expect(JSON.stringify(out), "image omitted").toContain("BBBB");
  });
});

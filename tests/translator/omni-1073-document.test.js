import "./registerAll.js";
import { describe, expect, it } from "vitest";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { CLAUDE_BLOCK, OPENAI_BLOCK, ROLE } from "../../open-sse/translator/schema/index.js";

const document = (source, extra = {}) => ({ type: CLAUDE_BLOCK.DOCUMENT, source, ...extra });
const translate = (blocks, target = FORMATS.OPENAI) => translateRequest(FORMATS.CLAUDE, target, "model", { model: "model", messages: [{ role: ROLE.USER, content: blocks }] }, false);

describe("OmniRoute #16617 top-level documents", () => {
  it("preserves a PDF through the OpenAI hub and Gemini", () => {
    const blocks = [document({ type: "base64", media_type: "application/pdf", data: "cGRm" }, { title: "a.pdf" })];
    expect(translate(blocks).messages[0].content).toEqual([{ type: OPENAI_BLOCK.FILE, file: { filename: "a.pdf", file_data: "data:application/pdf;base64,cGRm" } }]);
    expect(JSON.stringify(translate(blocks, FORMATS.GEMINI))).toContain('"inlineData":{"mimeType":"application/pdf","data":"cGRm"}');
  });
  it("keeps text and URL sources as text without fetching them", () => {
    const result = translate([document({ type: "text", data: "contents" }, { title: "notes" }), document({ type: "url", url: "https://example.test/a" })]);
    expect(JSON.stringify(result.messages)).toContain("[notes]\\ncontents");
    expect(JSON.stringify(result.messages)).toContain("https://example.test/a");
  });
  it("does not forward malformed base64 as a file", () => {
    const result = translate([document({ type: "base64", data: "not valid!" })]);
    expect(JSON.stringify(result.messages)).not.toContain("not valid!");
  });
});

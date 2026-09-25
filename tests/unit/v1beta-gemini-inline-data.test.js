import { describe, expect, it } from "vitest";

const { convertGeminiToInternal } = await import("../../src/app/api/v1beta/models/[...path]/geminiBridge.js");

const img = { inlineData: { mimeType: "image/png", data: "AAAA" } };
const imgPart = { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } };

describe("v1beta bridge keeps inlineData parts", () => {
  it("sends text + inlineData as a multimodal user message", () => {
    const out = convertGeminiToInternal({ contents: [{ role: "user", parts: [{ text: "What is this?" }, img] }] }, "m", false);
    expect(out.messages).toEqual([{ role: "user", content: [{ type: "text", text: "What is this?" }, imgPart] }]);
  });

  it("keeps an inlineData-only turn", () => {
    const pdf = { inlineData: { mimeType: "application/pdf", data: "JVBE" } };
    const out = convertGeminiToInternal({ contents: [{ role: "user", parts: [pdf] }] }, "m", false);
    expect(out.messages).toEqual([{ role: "user", content: [{ type: "image_url", image_url: { url: "data:application/pdf;base64,JVBE" } }] }]);
  });

  it("keeps an inlineData part sent next to a functionResponse", () => {
    const out = convertGeminiToInternal({
      contents: [
        { role: "model", parts: [{ functionCall: { name: "read_file", args: { path: "a.png" } } }] },
        { role: "user", parts: [{ functionResponse: { name: "read_file", response: { result: "ok" } } }, img] }
      ]
    }, "m", false);
    expect(out.messages.map((m) => m.role)).toEqual(["assistant", "tool", "user"]);
    expect(out.messages[2].content).toEqual([imgPart]);
  });
});

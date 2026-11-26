import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";

const PDF = "JVBERi0xLjcK";

function toAntigravityParts(content) {
  const body = { messages: [{ role: "user", content }], max_tokens: 16 };
  const out = translateRequest("claude", "antigravity", "claude-opus-4-6-thinking", body, true, { projectId: "p" }, "antigravity");
  return out.request.contents.flatMap((turn) => turn.parts);
}

describe("9router #3968 (10dd836abfc2) - PDF blocks for Claude models on Antigravity", () => {
  it("sends a base64 document as inline data next to the text", () => {
    const parts = toAntigravityParts([
      { type: "text", text: "read this" },
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: PDF } },
    ]);

    expect(parts).toContainEqual({ text: "read this" });
    expect(parts).toContainEqual({ inlineData: { mimeType: "application/pdf", data: PDF } });
  });

  it("adds no inline data for a document without bytes", () => {
    const parts = toAntigravityParts([
      { type: "text", text: "read this" },
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: "" } },
    ]);

    expect(parts.filter((part) => part.inlineData)).toEqual([]);
  });
});

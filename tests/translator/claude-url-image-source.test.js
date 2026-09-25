// Claude image blocks with a URL source (`{ type: "url", url }`) must survive
// translation to OpenAI (image_url) and Gemini (fileData.fileUri), both at the
// top level and inside tool_result blocks.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const URL = "https://example.com/cat.png";
const urlImage = { type: "image", source: { type: "url", url: URL } };

const body = () => ({
  max_tokens: 100,
  messages: [
    { role: "user", content: [{ type: "text", text: "look" }, urlImage] },
    { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "shot", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: [{ type: "text", text: "done" }, urlImage] }] }
  ]
});

describe("Claude URL image → OpenAI", () => {
  it("maps top-level and tool_result URL images to image_url parts", () => {
    const out = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "m", body(), false, null, null);
    const [user, , tool, followUp] = out.messages;
    expect(user.content).toContainEqual({ type: "image_url", image_url: { url: URL } });
    expect(tool.role).toBe("tool");
    expect(tool.content).toContain("done");
    expect(tool.content).not.toContain("\"source\"");
    expect(followUp.role).toBe("user");
    expect(followUp.content).toEqual([{ type: "image_url", image_url: { url: URL } }]);
  });
});

describe("Claude URL image → Gemini", () => {
  it("maps top-level and tool_result URL images to fileData parts", () => {
    const out = translateRequest(FORMATS.CLAUDE, FORMATS.GEMINI, "m", body(), false, null, null);
    const fileData = { fileData: { fileUri: URL, mimeType: "image/*" } };
    expect(out.contents[0].parts).toContainEqual(fileData);
    const resultParts = out.contents[2].parts;
    expect(resultParts[resultParts.length - 1]).toEqual(fileData);
    expect(JSON.stringify(resultParts[0])).not.toContain("\\\"source\\\"");
  });
});

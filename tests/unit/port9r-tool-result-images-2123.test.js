import { describe, it, expect } from "vitest";
import { claudeToOpenAIRequest } from "../../open-sse/translator/request/claude-to-openai.js";

const image = (data, media_type = "image/png") => ({ type: "image", source: { type: "base64", media_type, data } });
const request = (results) => claudeToOpenAIRequest("m", { messages: [
  { role: "assistant", content: results.map((_, i) => ({ type: "tool_use", id: `c${i}`, name: "shot", input: {} })) },
  { role: "user", content: results.map((content, i) => ({ type: "tool_result", tool_use_id: `c${i}`, content })) }
] }, false);

describe("Claude tool result images", () => {
  it("keeps tool responses contiguous and forwards image-only and mixed results", () => {
    const out = request([[image("AQID")], [{ type: "text", text: "ready" }, image("BAUG"), { type: "image", source: { type: "url", url: "https://example.test/a.png" } }]]);
    expect(out.messages.map(m => m.role)).toEqual(["assistant", "tool", "tool", "user"]);
    expect(out.messages[2].content).toContain("ready");
    expect(out.messages[3].content.filter(p => p.type === "image_url").map(p => p.image_url.url)).toEqual(["data:image/png;base64,AQID", "data:image/png;base64,BAUG", "https://example.test/a.png"]);
  });
  it("shares the image budget across separate turns", () => {
    const data = "A".repeat(700000);
    const block = { type: "tool_result", tool_use_id: "c", content: [image(data)] };
    const out = claudeToOpenAIRequest("m", { messages: [{ role: "user", content: [block] }, { role: "user", content: [block] }] }, false);
    expect(out.messages.filter(m => m.role === "user")).toHaveLength(1);
    expect(out.messages.at(-1).content).toContain("omitted image");
  });
  it("omits invalid and aggregate oversized images without exposing bytes", () => {
    const large = "A".repeat(700000);
    const out = request([[image(large), image(large), image("invalid!"), image("AAAA", "text/html")]]);
    const json = JSON.stringify(out);
    expect(out.messages[1].content).toContain("omitted image");
    expect(out.messages[2].content.filter(p => p.type === "image_url")).toHaveLength(1);
    expect(json).not.toContain("invalid!");
    expect(json).not.toContain("text/html;base64");
  });
});

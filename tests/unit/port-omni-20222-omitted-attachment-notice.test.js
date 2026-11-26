import { describe, it, expect } from "vitest";
import { claudeToOpenAIRequest } from "../../open-sse/translator/request/claude-to-openai.js";

const translate = (content) => claudeToOpenAIRequest("m", { messages: [{ role: "user", content }] }, false).messages;
const fileSource = { type: "file", file_id: "file_1" };

describe("OmniRoute #20222: Claude to OpenAI keeps unsupported-only turns", () => {
  it.each(["image", "document"])("keeps a notice for a turn with only an unsupported %s source", (type) => {
    expect(translate([{ type, source: fileSource }])).toEqual([{ role: "user", content: `[Attachment omitted: unsupported ${type} source]` }]);
  });

  it("adds no notice when the turn still has text", () => {
    expect(JSON.stringify(translate([{ type: "text", text: "look" }, { type: "image", source: fileSource }]))).not.toContain("Attachment omitted");
  });

  it("leaves a tool-result turn unchanged", () => {
    const messages = translate([{ type: "tool_result", tool_use_id: "t1", content: "done" }]);
    expect(messages).toEqual([{ role: "tool", tool_call_id: "t1", content: "done" }]);
  });
});

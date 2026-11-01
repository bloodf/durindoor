// #1332: Chat→Responses keeps tool-result images as input_image media.
import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const body = (toolMessage) => ({
  messages: [
    { role: "user", content: "look" },
    { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "shot", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "c1", ...toolMessage },
  ],
  tools: [{ type: "function", function: { name: "shot", parameters: { type: "object" } } }],
});

const outputOf = (toolMessage) =>
  translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "m", body(toolMessage), false)
    .input.find((item) => item.type === "function_call_output").output;

describe("#1332 Chat→Responses tool-result media", () => {
  it("keeps a data URI image with its detail", () => {
    expect(outputOf({ content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA", detail: "high" } }] }))
      .toEqual([{ type: "input_image", image_url: "data:image/png;base64,AAAA", detail: "high" }]);
  });

  it("keeps the tool-error marker ahead of media", () => {
    expect(outputOf({ is_error: true, content: [
      { type: "text", text: "failed" },
      { type: "image_url", image_url: { url: "https://example.invalid/a.png" } },
    ] })).toEqual([
      { type: "input_text", text: "[Tool error]\n" },
      { type: "input_text", text: "failed" },
      { type: "input_image", image_url: "https://example.invalid/a.png", detail: "auto" },
    ]);
  });

  it("leaves text-only and string tool output as a string", () => {
    expect(outputOf({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] })).toBe("ab");
    expect(outputOf({ is_error: true, content: "boom" })).toBe("[Tool error]\nboom");
  });
});

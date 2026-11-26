import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

function toolContent(format, response) {
  const contents = [
    { role: "user", parts: [{ text: "run" }] },
    { role: "model", parts: [{ functionCall: { id: "call_1", name: "run", args: {} } }] },
    { role: "user", parts: [{ functionResponse: { id: "call_1", name: "run", response } }] },
  ];
  const body = format === FORMATS.ANTIGRAVITY ? { request: { contents } } : { contents };
  return translateRequest(format, FORMATS.OPENAI, "gpt-test", structuredClone(body), false)
    .messages.find((message) => message.role === "tool").content;
}

describe.each([FORMATS.GEMINI, FORMATS.ANTIGRAVITY])("upstream #5863: %s tool output", (format) => {
  it("passes Gemini CLI { output } text through without its wrapper", () => {
    expect(toolContent(format, { output: "line one\nline two" })).toBe("line one\nline two");
  });

  it("encodes a non-string output value", () => {
    expect(toolContent(format, { output: { code: 0 } })).toBe('{"code":0}');
  });

  it("keeps the whole object when output has sibling fields", () => {
    expect(JSON.parse(toolContent(format, { output: "x", error: "boom" }))).toEqual({ output: "x", error: "boom" });
  });

  it.each([0, false, null])("keeps a falsy result %s", (result) => {
    expect(toolContent(format, { result })).toBe(JSON.stringify(result));
  });
});

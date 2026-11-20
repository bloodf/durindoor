import { describe, expect, it } from "vitest";
import { appendComboPrompt } from "../../open-sse/rtk/comboPrompt.js";
import { injectCustomPrompt } from "../../open-sse/rtk/customPrompt.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("configured combo prompts", () => {
  it("inherits only explicit nonempty settings in outer-to-inner order without mutating the parent", () => {
    const outer = appendComboPrompt([], { outer: "outer", inner: "inner" }, "outer");
    const inner = appendComboPrompt(outer, { inner: "inner" }, "inner");
    expect(inner).toEqual(["outer", "inner"]);
    expect(outer).toEqual(["outer"]);
    expect(appendComboPrompt([], { outer: "  " }, "outer")).toEqual([]);
    expect(appendComboPrompt([], undefined, "outer")).toEqual([]);
  });
  it.each([
    [FORMATS.OPENAI, { messages: [{ role: "system", content: "client" }] }, (b) => b.messages[0].content],
    [FORMATS.CLAUDE, { system: [{ type: "text", text: "client" }], messages: [] }, (b) => b.system.map((x) => x.text).join("\n\n")],
    [FORMATS.GEMINI, { systemInstruction: { parts: [{ text: "client" }] } }, (b) => b.systemInstruction.parts.map((x) => x.text).join("\n\n")],
    [FORMATS.OPENAI_RESPONSES, { instructions: "client", input: "hello" }, (b) => b.instructions],
  ])("preserves native client instructions and appends ordered prompts once", (format, body, read) => {
    injectCustomPrompt(body, format, "outer\n\ninner");
    injectCustomPrompt(body, format, "outer\n\ninner");
    expect(read(body)).toBe("client\n\nouter\n\ninner");
  });
  it("keeps Kiro instructions in its existing user prefix", () => {
    const body = { conversationState: { currentMessage: { userInputMessage: { content: "client" } } } };
    injectCustomPrompt(body, FORMATS.KIRO, "outer\n\ninner");
    injectCustomPrompt(body, FORMATS.KIRO, "outer\n\ninner");
    expect(body.conversationState.currentMessage.userInputMessage.content).toBe("outer\n\ninner\n\nclient");
    expect(body).not.toHaveProperty("systemPrompt");
  });
});

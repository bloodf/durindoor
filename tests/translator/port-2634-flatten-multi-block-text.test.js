// Regression for upstream decolua/9router#2634 — text-only content-part arrays
// with multiple consecutive blocks must be flattened to a single string, while
// multimodal arrays keep their structure.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const T = (src, body, provider = null) => translateRequest(src, FORMATS.OPENAI, "m", body, true, null, provider, null, [], null, null, null);

describe("port #2634: multi-block text parts are flattened to a string", () => {
  it("Gemini user content with two consecutive text parts becomes one string", () => {
    const out = T(FORMATS.GEMINI, {
      contents: [{
        role: "user",
        parts: [{ text: "hello" }, { text: "world" }],
      }],
    });
    const user = out.messages.find((m) => m.role === "user");
    expect(user?.content).toBe("hello\nworld");
  });

  it("Antigravity assistant content with multiple text parts becomes one string", () => {
    const out = T(FORMATS.ANTIGRAVITY, {
      request: {
        contents: [{
          role: "model",
          parts: [{ text: "first" }, { text: "second" }, { text: "third" }],
        }],
      },
    });
    const asst = out.messages.find((m) => m.role === "assistant");
    expect(asst?.content).toBe("first\nsecond\nthird");
  });

  it("Claude user content with consecutive text blocks becomes one string", () => {
    const out = T(FORMATS.CLAUDE, {
      messages: [{
        role: "user",
        content: [{ type: "text", text: "a" }, { type: "text", text: "b" }],
      }],
    });
    const user = out.messages.find((m) => m.role === "user");
    expect(user?.content).toBe("a\nb");
  });

  it("Gemini assistant with two text parts plus a functionCall still flattens text", () => {
    const out = T(FORMATS.GEMINI, {
      contents: [{
        role: "model",
        parts: [
          { text: "a" },
          { text: "b" },
          { functionCall: { name: "get_weather", args: { city: "NYC" } } },
        ],
      }],
    });
    const asst = out.messages.find((m) => m.role === "assistant");
    expect(asst?.content).toBe("a\nb");
    expect(asst?.tool_calls).toHaveLength(1);
    expect(asst?.tool_calls?.[0]).toMatchObject({ type: "function", function: { name: "get_weather" } });
  });
});

describe("port #2634: multimodal arrays stay as structured parts", () => {
  it("Gemini user content with text + image keeps array form", () => {
    const out = T(FORMATS.GEMINI, {
      contents: [{
        role: "user",
        parts: [
          { text: "describe this" },
          { inlineData: { mimeType: "image/png", data: "BASE64DATA" } },
        ],
      }],
    });
    const user = out.messages.find((m) => m.role === "user");
    expect(Array.isArray(user?.content)).toBe(true);
    expect(user?.content).toHaveLength(2);
    expect(user?.content?.[0]).toMatchObject({ type: "text", text: "describe this" });
    expect(user?.content?.[1]).toMatchObject({ type: "image_url", image_url: { url: expect.stringContaining("data:image/png;base64,BASE64DATA") } });
  });
});

describe("port #2634: single text block remains a plain string", () => {
  it("Gemini single text part still becomes a plain string", () => {
    const out = T(FORMATS.GEMINI, {
      contents: [{
        role: "user",
        parts: [{ text: "hi" }],
      }],
    });
    const user = out.messages.find((m) => m.role === "user");
    expect(user?.content).toBe("hi");
  });
});

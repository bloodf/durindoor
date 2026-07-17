import { describe, it, expect } from "vitest";
import { contentToText, foldMessages } from "../../open-sse/executors/kimi-web.js";

describe("kimi-web content part folding", () => {
  it("concatenates multiple text parts with newlines", () => {
    const text = contentToText([
      { type: "text", text: "hello" },
      { type: "text", text: "world" },
    ]);
    expect(text).toBe("hello\nworld");
  });

  it("describes unsupported media parts instead of stringifying JSON", () => {
    const text = contentToText([
      { type: "text", text: "look at this" },
      { type: "image_url", image_url: { url: "https://example.com/img.png" } },
    ]);
    expect(text).toBe("look at this\n[unsupported-part: image_url]");
  });

  it("folds multimodal array content into the prompt correctly", () => {
    const prompt = foldMessages([
      { role: "user", content: [{ type: "text", text: "hello" }, { type: "text", text: "world" }] },
    ]);
    expect(prompt).toBe("hello\nworld");
  });

  it("keeps plain string content unchanged", () => {
    const prompt = foldMessages([
      { role: "system", content: "you are a robot" },
      { role: "user", content: "hello" },
    ]);
    expect(prompt).toBe("you are a robot\n\nhello");
  });

  it("still JSON-stringifies non-array object content as fallback", () => {
    const text = contentToText({ custom: "object" });
    expect(text).toBe(JSON.stringify({ custom: "object" }));
  });
});

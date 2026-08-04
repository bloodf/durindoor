import { describe, expect, it } from "vitest";
import { detectFormat } from "../../open-sse/services/provider.js";

describe("Claude format detection", () => {
  it("recognizes the kebab-case anthropic-version body field", () => {
    expect(detectFormat({
      "anthropic-version": "2023-06-01",
      max_tokens: 32,
      messages: [{ role: "user", content: "hello" }],
    })).toBe("claude");
  });
});
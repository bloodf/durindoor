import { describe, it, expect } from "vitest";
import { detectFormatByEndpoint, FORMATS } from "../../open-sse/translator/formats.js";
import { detectFormat } from "../../open-sse/services/provider.js";

describe("format detection by endpoint + body", () => {
  it("ambiguous endpoint + kebab-case anthropic-version body yields Claude via fallback", () => {
    const body = {
      model: "claude-3-5-sonnet",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 1024,
      "anthropic-version": "2023-06-01",
    };
    expect(detectFormatByEndpoint("/v1/unknown", body)).toBeNull();
    expect(detectFormat(body)).toBe(FORMATS.CLAUDE);
  });

  it("relative /v1/messages endpoint resolves Claude directly", () => {
    const body = {
      model: "claude-3-5-sonnet",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 1024,
    };
    expect(detectFormatByEndpoint("/v1/messages", body)).toBe(FORMATS.CLAUDE);
  });
});

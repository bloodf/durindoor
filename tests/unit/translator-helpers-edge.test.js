// Locks edge cases flagged in docs 11 §1/§4 that were only covered indirectly.
import { describe, it, expect } from "vitest";
import { normalizeClaudePassthrough } from "../../open-sse/translator/formats/claude.js";
import { parseDataUri, encodeDataUri } from "../../open-sse/translator/concerns/image.js";

describe("normalizeClaudePassthrough — haiku adaptive thinking (docs 11 §1)", () => {
  it("downgrades adaptive thinking to enabled+budget for haiku models", () => {
    const out = normalizeClaudePassthrough({ thinking: { type: "adaptive" } }, "claude-haiku-4-5");
    expect(out.thinking).toEqual({ type: "enabled", budget_tokens: 10000 });
  });

  it("keeps adaptive thinking for sonnet/opus", () => {
    const out = normalizeClaudePassthrough({ thinking: { type: "adaptive" } }, "claude-sonnet-4-6");
    expect(out.thinking).toEqual({ type: "adaptive" });
  });

  it("hoists mid-conversation system messages by default", () => {
    const out = normalizeClaudePassthrough({
      messages: [
        { role: "user", content: "hi" },
        { role: "system", content: "be brief" },
      ],
    });
    expect(out.system).toEqual([{ type: "text", text: "be brief" }]);
    expect(out.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("reconciles native thinking budgets below max_tokens", () => {
    const out = normalizeClaudePassthrough({
      model: "claude-haiku-4-5",
      max_tokens: 4096,
      thinking: { type: "enabled", budget_tokens: 8192 },
      messages: [{ role: "user", content: "hello" }],
    }, "claude-haiku-4-5", "claude");

    expect(out.max_tokens).toBe(9216);
    expect(out.thinking.budget_tokens).toBe(8192);
    expect(out.thinking.budget_tokens).toBeLessThan(out.max_tokens);
  });

  it("shrinks an over-ceiling native budget while preserving answer headroom", () => {
    const out = normalizeClaudePassthrough({
      model: "claude-haiku-4-5",
      max_tokens: 200000,
      thinking: { type: "enabled", budget_tokens: 128000 },
      messages: [{ role: "user", content: "hello" }],
    }, "claude-haiku-4-5", "claude");

    expect(out.max_tokens).toBe(64000);
    expect(out.thinking.budget_tokens).toBe(62976);
  });
});

describe("parseDataUri / encodeDataUri (docs 11 §4)", () => {
  it("parses a base64 data uri", () => {
    expect(parseDataUri("data:image/png;base64,AAAB")).toEqual({ mimeType: "image/png", base64: "AAAB" });
  });

  it("tolerates newlines inside base64 payload", () => {
    expect(parseDataUri("data:image/jpeg;base64,AA\nBB")?.base64).toBe("AA\nBB");
  });

  it("returns null for http urls and non-strings", () => {
    expect(parseDataUri("https://x/y.png")).toBeNull();
    expect(parseDataUri(null)).toBeNull();
  });

  it("encode/parse roundtrip", () => {
    const uri = encodeDataUri("image/webp", "ZZZ");
    expect(parseDataUri(uri)).toEqual({ mimeType: "image/webp", base64: "ZZZ" });
  });
});

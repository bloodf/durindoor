// Port of OmniRoute's "fake success" 2xx-body classifier (#13461 / #13910).
//
// A free/web-session provider (Pollinations, Perplexity web) can answer a
// genuine failure (expired session, exhausted free-tier credits) with HTTP
// 200 and a structurally normal completion whose message content is just the
// provider's own error prose. Neither the existing status-code classifiers
// (gated on 4xx) nor the empty-content check in nonStreamingHandler.js
// (structural emptiness only) catch this on their own — this classifier is a
// narrow, additive check for exactly that gap.
import { describe, expect, it } from "vitest";
import {
  classifyFakeSuccessBody,
  extractAssistantText,
  isFakeSuccessBodyAllowlistedProvider
} from "open-sse/services/fakeSuccessBodyClassifier.js";

describe("classifyFakeSuccessBody (#13910)", () => {
  it("flags a short credits-exhausted body for an allowlisted provider", () => {
    const content = "You have run out of credits. Please sign up at https://enter.pollinations.ai to continue.";
    expect(classifyFakeSuccessBody(content, "pollinations")).toBe("quota_exhausted");
  });

  it("flags an account-deactivated body for an allowlisted provider", () => {
    const content = "Sorry, your account has been suspended. Please contact support.";
    expect(classifyFakeSuccessBody(content, "perplexity-web")).toBe("account_deactivated");
  });

  it("ignores an unrecognized provider even with an identical phrase (allowlist guard)", () => {
    const content = "Sorry, out of credits. Please sign up to continue.";
    expect(classifyFakeSuccessBody(content, "openai")).toBeNull();
    expect(classifyFakeSuccessBody(content, "anthropic")).toBeNull();
    expect(classifyFakeSuccessBody(content, null)).toBeNull();
    expect(classifyFakeSuccessBody(content, undefined)).toBeNull();
  });

  it("ignores a long legitimate answer that merely mentions credits", () => {
    const longAnswer =
      "Managing your cloud spend well means watching a few things closely: set a monthly budget " +
      "alert, review your invoice line items weekly, and make sure you never run out of credits " +
      "mid-project by topping up before the low-balance warning fires. A lot of teams also sign up " +
      "for a committed-use discount once their usage is predictable, which can meaningfully lower " +
      "the effective per-unit cost over a full year of steady traffic.";
    expect(longAnswer.length).toBeGreaterThan(400);
    expect(classifyFakeSuccessBody(longAnswer, "pollinations")).toBeNull();
  });

  it("ignores short content with no recognized signal phrase", () => {
    const content = "Please go to perplexity.ai and sign up to continue using this feature.";
    expect(classifyFakeSuccessBody(content, "perplexity-web")).toBeNull();
  });

  it("ignores a normal short answer for an allowlisted provider (no false positive)", () => {
    expect(classifyFakeSuccessBody("The capital of France is Paris.", "pollinations")).toBeNull();
    expect(classifyFakeSuccessBody("Sure! Here is a haiku about credit unions and community banking.", "pollinations")).toBeNull();
  });

  it("ignores empty content", () => {
    expect(classifyFakeSuccessBody("", "pollinations")).toBeNull();
    expect(classifyFakeSuccessBody(null, "pollinations")).toBeNull();
  });
});

describe("isFakeSuccessBodyAllowlistedProvider", () => {
  it("matches only the narrow allowlist, case-insensitively", () => {
    expect(isFakeSuccessBodyAllowlistedProvider("pollinations")).toBe(true);
    expect(isFakeSuccessBodyAllowlistedProvider("Perplexity-Web")).toBe(true);
    expect(isFakeSuccessBodyAllowlistedProvider("openai")).toBe(false);
    expect(isFakeSuccessBodyAllowlistedProvider(null)).toBe(false);
  });
});

describe("extractAssistantText", () => {
  it("extracts OpenAI chat-completion string content", () => {
    const response = { choices: [{ message: { role: "assistant", content: "hello" } }] };
    expect(extractAssistantText(response)).toBe("hello");
  });

  it("extracts Claude message text blocks", () => {
    const response = { type: "message", content: [{ type: "text", text: "hi there" }] };
    expect(extractAssistantText(response)).toBe("hi there");
  });

  it("returns an empty string for a shape with no text content", () => {
    expect(extractAssistantText({ choices: [{ message: { tool_calls: [{}] } }] })).toBe("");
    expect(extractAssistantText(null)).toBe("");
  });
});

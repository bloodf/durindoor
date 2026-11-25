import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

const claudeBody = (extra = {}) => ({
  model: "gpt-6.1-sol",
  max_tokens: 1000,
  stream: true,
  messages: [{ role: "user", content: "hi" }],
  ...extra,
});

const translate = (target, extra, provider = "codex") =>
  translateRequest(FORMATS.CLAUDE, target, "gpt-6.1-sol", claudeBody(extra), true, null, provider);

describe("decolua/9router#4642 service_tier through the Anthropic to OpenAI pivot", () => {
  it("keeps priority from Claude through Responses and the Codex executor", () => {
    const translated = translate(FORMATS.OPENAI_RESPONSES, { service_tier: "priority" });
    const body = new CodexExecutor().transformRequest("gpt-6.1-sol", translated, true, {});
    expect(body.service_tier).toBe("priority");
  });

  it.each([["flex", "flex"], ["auto", "auto"], ["standard_only", "default"]])("maps %s to %s on the OpenAI leg", (tier, expected) => {
    expect(translate(FORMATS.OPENAI, { service_tier: tier }).service_tier).toBe(expected);
  });

  it.each([["bogus"], [42], [null]])("drops the unusable tier %s", (tier) => {
    expect(translate(FORMATS.OPENAI, { service_tier: tier })).not.toHaveProperty("service_tier");
  });

  it("adds no tier when the client sent none", () => {
    expect(translate(FORMATS.OPENAI_RESPONSES, {})).not.toHaveProperty("service_tier");
  });
});

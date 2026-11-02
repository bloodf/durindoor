import { describe, expect, it } from "vitest";

import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { openaiToAntigravityRequest } from "../../open-sse/translator/request/openai-to-gemini.js";

const HEADER = "x-anthropic-billing-header: cc_version=2.1.275.f15; cc_entrypoint=cli;";

function systemTextSentToAntigravity(systemContent) {
  // OpenAI-format client (e.g. a proxy converting Claude Code to /v1/chat/completions).
  const body = openaiToAntigravityRequest("gemini-3.8-flash-tiered", {
    messages: [
      { role: "system", content: systemContent },
      { role: "user", content: "hi" },
    ],
  }, true);
  const finalBody = new AntigravityExecutor().transformRequest("gemini-3.8-flash-tiered", body, true, {});
  return finalBody.request.systemInstruction.parts.map((p) => p.text).join("\n");
}

describe("Antigravity strips the Claude Code billing header from system prompts", () => {
  it("removes the header line prepended by Claude Code", () => {
    const text = systemTextSentToAntigravity(`${HEADER}\n\nYou are Claude Code, Anthropic's official CLI for Claude.`);
    expect(text).not.toContain("x-anthropic-billing-header");
    expect(text).toContain("You are Claude Code, Anthropic's official CLI for Claude.");
  });

  it("removes the header when it is not the first line", () => {
    const text = systemTextSentToAntigravity(`Some preamble\n${HEADER}\nRest of prompt`);
    expect(text).not.toContain("x-anthropic-billing-header");
    expect(text).toContain("Some preamble");
    expect(text).toContain("Rest of prompt");
  });

  it("leaves prompts without the header untouched", () => {
    const text = systemTextSentToAntigravity("You are a helpful assistant.");
    expect(text).toContain("You are a helpful assistant.");
  });

  it("rewrites the Hermes Agent identity line without touching the rest of the prompt", () => {
    const text = systemTextSentToAntigravity("You are Hermes Agent, an intelligent AI assistant created by Nous Research. Be concise.");
    expect(text).toBe("You are an AI assistant. Be concise.");
  });

  it.each([
    "You are Hermes Agent, an AI agent built by Nous Research.",
    "You are Hermes, an AI assistant created by Nous Research.",
    "You are Hermes Agent.",
    "You are Hermes created by Nous Research.",
  ])("rewrites the Hermes identity variant %j (upstream a61fc6a0)", (line) => {
    expect(systemTextSentToAntigravity(`${line} Use tools.`)).toBe("You are an AI assistant. Use tools.");
  });

  it.each([
    "You are Claude Code, Anthropic's official CLI for Claude. Be concise.",
    "You are a coding assistant. Hermes is the name of a file.",
    "You are Hermione, an AI assistant.",
    "We use Hermes Agent tooling created by Nous Research in this repo.",
  ])("leaves non-Hermes-identity system text untouched: %j", (text) => {
    expect(systemTextSentToAntigravity(text)).toBe(text);
  });

  it("leaves unrelated system content untouched by the Hermes rewrite", () => {
    const text = systemTextSentToAntigravity("You are a helpful assistant named Hermes.");
    expect(text).toBe("You are a helpful assistant named Hermes.");
  });
});

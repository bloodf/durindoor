import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { extractReasoningText } from "../../open-sse/translator/concerns/reasoning.js";
import {
  isInternalReasoningPlaceholder,
  NON_ANTHROPIC_THINKING_PLACEHOLDER,
} from "../../open-sse/utils/reasoningPlaceholder.js";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";
import { translateOpenAIToClaudeIfNeeded } from "../../open-sse/translator/response/openai-to-claude-json.js";

const chunk = (delta) => ({
  id: "chatcmpl-x",
  model: "gpt-4.1",
  choices: [{ index: 0, delta, finish_reason: null }],
});

const flatten = (results) => results.flat().filter(Boolean);

describe("OmniRoute #7919 — reasoning_text is read as reasoning", () => {
  it("extractReasoningText picks up delta.reasoning_text", () => {
    expect(extractReasoningText({ reasoning_text: "copilot thought" })).toBe("copilot thought");
  });

  it("non-stream OpenAI->Claude surfaces reasoning_text as a thinking block (empty content)", () => {
    const out = translateOpenAIToClaudeIfNeeded(
      {
        object: "chat.completion",
        choices: [
          { index: 0, finish_reason: "stop", message: { role: "assistant", content: "", reasoning_text: "let me think" } },
        ],
      },
      "openai",
    );
    const thinking = out.content.find((b) => b.type === "thinking");
    expect(thinking).toBeTruthy();
    expect(thinking.thinking).toBe("let me think");
  });

  it("streaming OpenAI->Claude emits a thinking delta for reasoning_text", () => {
    const state = { nextBlockIndex: 0 };
    const res = flatten([openaiToClaudeResponse(chunk({ reasoning_text: "streamed thought" }), state)]);
    const td = res.find((e) => e.delta?.type === "thinking_delta");
    expect(td).toBeTruthy();
    expect(td.delta.thinking).toBe("streamed thought");
  });
});

describe("OmniRoute #7912 — internal reasoning replay sentinel is suppressed", () => {
  it("isInternalReasoningPlaceholder only matches the exact sentinel", () => {
    expect(isInternalReasoningPlaceholder(NON_ANTHROPIC_THINKING_PLACEHOLDER)).toBe(true);
    expect(isInternalReasoningPlaceholder("  " + NON_ANTHROPIC_THINKING_PLACEHOLDER + " ")).toBe(true);
    expect(isInternalReasoningPlaceholder("real reasoning")).toBe(false);
    expect(isInternalReasoningPlaceholder("")).toBe(false);
  });

  it("streaming OpenAI->Claude does NOT emit a thinking block for the sentinel", () => {
    const state = { nextBlockIndex: 0 };
    const res = flatten([openaiToClaudeResponse(chunk({ reasoning_content: NON_ANTHROPIC_THINKING_PLACEHOLDER }), state)]);
    expect(res.some((e) => e.delta?.type === "thinking_delta")).toBe(false);
    expect(res.some((e) => e.type === "content_block_start" && e.content_block?.type === "thinking")).toBe(false);
  });

  it("a genuine reasoning string still passes through", () => {
    const state = { nextBlockIndex: 0 };
    const res = flatten([openaiToClaudeResponse(chunk({ reasoning_content: "real reasoning" }), state)]);
    const td = res.find((e) => e.delta?.type === "thinking_delta");
    expect(td?.delta.thinking).toBe("real reasoning");
  });
});

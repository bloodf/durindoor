// decolua/9router #5050 (already present): a Claude stream that ends with message_stop and
// no message_delta must still report cache counters to OpenAI clients.
import { describe, it, expect } from "vitest";
import { initState } from "../../open-sse/translator/index.js";
import "../translator/registerAll.js";
import { claudeToOpenAIResponse } from "../../open-sse/translator/response/claude-to-openai.js";

const start = (usage) => ({ type: "message_start", message: { id: "msg_1", model: "claude-sonnet-5-5", usage } });
const lastUsage = (out) => out?.[out.length - 1]?.usage || null;

describe("claude→openai message_stop usage keeps cache counters", () => {
  it("reports cached_tokens and counts cache tokens in prompt_tokens", () => {
    const state = initState("claude");
    claudeToOpenAIResponse(start({ input_tokens: 100, cache_read_input_tokens: 9000, cache_creation_input_tokens: 50, output_tokens: 0 }), state);
    const usage = lastUsage(claudeToOpenAIResponse({ type: "message_stop" }, state));
    expect(usage.prompt_tokens_details.cached_tokens).toBe(9000);
    expect(usage.prompt_tokens).toBe(9150);
  });

  it("omits the details block when nothing was cached", () => {
    const state = initState("claude");
    claudeToOpenAIResponse(start({ input_tokens: 100, output_tokens: 0 }), state);
    const usage = lastUsage(claudeToOpenAIResponse({ type: "message_stop" }, state));
    expect(usage.prompt_tokens).toBe(100);
    expect(usage.prompt_tokens_details).toBeUndefined();
  });
});

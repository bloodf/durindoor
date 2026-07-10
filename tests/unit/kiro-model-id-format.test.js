import { describe, expect, it } from "vitest";
import { resolveKiroModel } from "../../open-sse/config/kiroConstants.js";
import { openaiToKiroRequest } from "../../open-sse/translator/request/openai-to-kiro.js";
import { claudeToKiroRequest } from "../../open-sse/translator/request/claude-to-kiro.js";

/**
 * Current Kiro accepts the catalog's dotted Claude version IDs on the wire.
 * A rejected upstream experiment converted those dots to dashes; live Kiro
 * validation and the current upstream implementations use the dotted IDs.
 */
describe("Kiro wire model IDs", () => {
  it("resolves synthetic suffixes without rewriting the upstream version", () => {
    expect(resolveKiroModel("claude-sonnet-4.5-thinking-agentic")).toEqual({
      upstream: "claude-sonnet-4.5",
      agentic: true,
      thinking: true,
    });
    expect(resolveKiroModel("claude-haiku-4.5-thinking").upstream).toBe("claude-haiku-4.5");
    expect(resolveKiroModel("deepseek-3.2-thinking").upstream).toBe("deepseek-3.2");
  });

  it("preserves dotted Claude IDs in OpenAI-to-Kiro payloads", () => {
    const result = openaiToKiroRequest(
      "claude-sonnet-4.5-thinking-agentic",
      { messages: [{ role: "user", content: "hello" }], stream: false },
      false,
      {},
    );

    expect(result.conversationState.currentMessage.userInputMessage.modelId).toBe(
      "claude-sonnet-4.5",
    );
    expect(Reflect.ownKeys(result).filter((key) => String(key).startsWith("_"))).toEqual([]);
  });

  it("preserves dotted Claude IDs in direct Claude-to-Kiro payloads", () => {
    const result = claudeToKiroRequest(
      "claude-sonnet-4.5-agentic",
      { messages: [{ role: "user", content: "hello" }], max_tokens: 128 },
      false,
      {},
    );

    expect(result.conversationState.currentMessage.userInputMessage.modelId).toBe(
      "claude-sonnet-4.5",
    );
    expect(Reflect.ownKeys(result).filter((key) => String(key).startsWith("_"))).toEqual([]);
  });
});

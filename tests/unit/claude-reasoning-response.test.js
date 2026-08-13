import { describe, it, expect } from "vitest";
import { claudeToOpenAIResponse } from "../../open-sse/translator/response/claude-to-openai.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { filterUsageForFormat } from "../../open-sse/utils/usageTracking.js";
import { calculateCostFromTokens } from "../../open-sse/providers/pricing.js";

function collect(chunks) {
  const state = { toolCalls: new Map() };
  return chunks.flatMap((chunk) => claudeToOpenAIResponse(chunk, state) || []);
}

describe("Claude reasoning response translation (#2158)", () => {
  it("keeps thinking deltas in reasoning_content without leaking think tags into content", () => {
    const output = collect([
      { type: "message_start", message: { id: "msg_12345678", model: "claude", usage: {} } },
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "private chain" } },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "visible answer" } },
      { type: "content_block_stop", index: 1 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { input_tokens: 1, output_tokens: 2 } },
    ]);

    const contentDeltas = output.map((chunk) => chunk.choices?.[0]?.delta?.content).filter(Boolean);
    const content = contentDeltas.join("");
    const reasoning = output.map((chunk) => chunk.choices?.[0]?.delta?.reasoning_content || "").join("");

    expect(contentDeltas).toEqual(["visible answer"]);
    expect(contentDeltas).not.toContain("<think>");
    expect(contentDeltas).not.toContain("</think>");
    expect(content).toBe("visible answer");
    expect(reasoning).toBe("private chain");
  });

  it("surfaces message_delta thinking usage without changing computed cost", () => {
    const state = { toolCalls: new Map() };
    const chunks = [
      { type: "message_start", message: { id: "msg_usage", model: "claude", usage: { input_tokens: 22, output_tokens: 1 } } },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 267, output_tokens_details: { thinking_tokens: 85 } } },
    ];
    for (const chunk of chunks) claudeToOpenAIResponse(chunk, state);
    const usage = filterUsageForFormat(state.usage, FORMATS.OPENAI);
    expect(usage.completion_tokens).toBe(267);
    expect(usage.completion_tokens_details).toEqual({ reasoning_tokens: 85 });
    expect(usage.output_tokens_details).toEqual({ thinking_tokens: 85 });
    const pricing = { input: 3, output: 15, reasoning: 30 };
    expect(usage.reasoning_tokens).toBeUndefined();
    expect(calculateCostFromTokens(usage, pricing)).toBe(
      calculateCostFromTokens({ prompt_tokens: 22, completion_tokens: 267 }, pricing),
    );
  });

  it("surfaces thinking usage to non-streaming OpenAI clients", () => {
    const response = translateNonStreamingResponse({
      id: "msg_nonstream",
      model: "claude",
      content: [{ type: "text", text: "answer" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 22, output_tokens: 267, output_tokens_details: { thinking_tokens: 85 } },
    }, FORMATS.CLAUDE, FORMATS.OPENAI);

    expect(response.usage).toMatchObject({
      prompt_tokens: 22,
      completion_tokens: 267,
      completion_tokens_details: { reasoning_tokens: 85 },
      output_tokens_details: { thinking_tokens: 85 },
    });
    const pricing = { input: 3, output: 15, reasoning: 30 };
    expect(response.usage.reasoning_tokens).toBeUndefined();
    expect(calculateCostFromTokens(response.usage, pricing)).toBe(
      calculateCostFromTokens({ prompt_tokens: 22, completion_tokens: 267 }, pricing),
    );
  });
});

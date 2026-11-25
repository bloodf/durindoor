import { describe, expect, it } from "vitest";
import { initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { openaiToOpenAIResponsesResponse } from "../../open-sse/translator/response/openai-responses.js";
import { normalizeInlineThinkingResponse, resolveInlineThinkingFormat } from "../../open-sse/handlers/chatCore/inlineThinking.js";
import { createResponsesApiTransformStream } from "../../open-sse/transformer/responsesTransformer.js";

const chunk = (delta, finish_reason = null) => ({ model: "upstream-model", choices: [{ index: 0, delta, finish_reason }] });
const text = (events, type) => events.filter(e => e.event === type).map(e => e.data.delta).join("");
function translate(provider, model, deltas) {
  const state = { ...initState(FORMATS.OPENAI_RESPONSES), provider, requestedModel: model };
  return [...deltas.flatMap(delta => openaiToOpenAIResponsesResponse(chunk(delta), state)), ...openaiToOpenAIResponsesResponse(chunk({}, "stop"), state)];
}

describe("textual reasoning route scope", () => {
  it("preserves ordinary and split literal tags while keeping native reasoning", () => {
    const events = translate("openai", "gpt-test", [{ reasoning_content: "native" }, { content: "before <thi" }, { content: "nk>literal</think> after" }]);
    expect(text(events, "response.output_text.delta")).toBe("before <think>literal</think> after");
    expect(text(events, "response.reasoning_summary_text.delta")).toBe("native");
  });
  it("extracts split tags for the configured MiniMax transport and model", () => {
    const events = translate("minimax", "MiniMax-M3", [{ content: "<thi" }, { content: "nk>reason</thi" }, { content: "nk>answer" }]);
    expect(text(events, "response.output_text.delta")).toBe("answer");
    expect(text(events, "response.reasoning_summary_text.delta")).toBe("reason");
    expect(resolveInlineThinkingFormat("minimax-cn", "MiniMax-M3", FORMATS.OPENAI)).toBeTruthy();
    expect(resolveInlineThinkingFormat("openai", "MiniMax-M3", FORMATS.OPENAI)).toBeNull();
    expect(resolveInlineThinkingFormat("minimax", "MiniMax-M3", FORMATS.CLAUDE)).toBeNull();
  });
  it("scopes nonstream normalization to configured routing", () => {
    const body = { choices: [{ message: { content: "<think>reason</think>answer" } }] };
    expect(normalizeInlineThinkingResponse(body, { provider: "openai", model: "MiniMax-M3", targetFormat: FORMATS.OPENAI }).responseBody).toEqual(body);
    expect(normalizeInlineThinkingResponse(body, { provider: "minimax", model: "MiniMax-M3", targetFormat: FORMATS.OPENAI }).responseBody.choices[0].message).toMatchObject({ content: "answer", reasoning_content: "reason" });
  });
  it("preserves literal text in the standalone Responses stream transformer", async () => {
    const input = [chunk({ content: "<thi" }), chunk({ content: "nk>literal</think>" }), chunk({}, "stop")].map(c => `data: ${JSON.stringify(c)}\n\n`).join("");
    const source = new Response(input).body.pipeThrough(createResponsesApiTransformStream());
    const output = await new Response(source).text();
    const events = output.split("\n").filter(line => line.startsWith("data: {")).map(line => JSON.parse(line.slice(6)));
    expect(events.filter(e => e.type === "response.output_text.delta").map(e => e.delta).join("")).toBe("<think>literal</think>");
  });
});

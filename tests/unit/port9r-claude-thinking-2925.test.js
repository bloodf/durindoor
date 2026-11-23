import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { encodeClaudeThinking, decodeClaudeThinking } from "../../open-sse/translator/concerns/claudeThinkingEnvelope.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { initState, translateRequest, translateResponse } from "../../open-sse/translator/index.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";

const model = "claude-test";
const blocks = [{ type: "thinking", thinking: "plan", signature: "signed" }, { type: "redacted_thinking", data: "opaque" }];
const history = (item, target = model) => translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE, target, { input: [item, { type: "function_call", call_id: "call_1", name: "run", arguments: "{}" }] }, true, {});

describe("Claude signed thinking continuity", () => {
  it("authenticates the model and payload and preserves foreign envelopes", () => {
    const envelope = encodeClaudeThinking(model, blocks);
    expect(decodeClaudeThinking(envelope, model)).toEqual(blocks);
    expect(decodeClaudeThinking(envelope, "other-model")).toBeNull();
    const [payload, mac] = envelope.split(".");
    expect(decodeClaudeThinking(`${payload.slice(0, -1)}A.${mac}`, model)).toBeNull();
    expect(decodeClaudeThinking("foreign:encrypted", model)).toBeNull();
    expect(history({ type: "reasoning", encrypted_content: `${envelope}#Eg==`, summary: [] }).messages[0].content.some((b) => b.type === "thinking")).toBe(false);
    expect(history({ type: "reasoning", encrypted_content: envelope, summary: [] }).messages[0].content.slice(0, 2)).toEqual(blocks);
    expect(history({ type: "reasoning", encrypted_content: envelope, summary: [] }, "other-model").messages[0].content.some((b) => b.type === "thinking")).toBe(false);
  });

  it("round trips streamed thinking and tools through Responses", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    const events = [
      { type: "message_start", message: { id: "m", model } },
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "plan" } },
      { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "signed" } },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: blocks[1] },
      { type: "content_block_stop", index: 1 },
      { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "call_1", name: "run", input: {} } },
      { type: "content_block_stop", index: 2 },
      { type: "message_delta", delta: { stop_reason: "tool_use" } },
    ].flatMap((event) => translateResponse(FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES, event, state) || []);
    const reasoning = events.find((event) => event.event === "response.output_item.done" && event.data.item.type === "reasoning")?.data.item;
    expect(decodeClaudeThinking(reasoning?.encrypted_content, model)).toEqual(blocks);
    expect(history(reasoning).messages[0].content.slice(0, 2)).toEqual(blocks);
  });

  it("projects collected completions with an empty reasoning summary", () => {
    const result = translateNonStreamingResponse({ id: "m", model, type: "message", role: "assistant", content: [...blocks, { type: "tool_use", id: "call_1", name: "run", input: {} }], stop_reason: "tool_use" }, FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES, { model });
    const item = (result.response || result).output.find((entry) => entry.type === "reasoning");
    expect(history(item).messages[0].content.slice(0, 2)).toEqual(blocks);
  });
});

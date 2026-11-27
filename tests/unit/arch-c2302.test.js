import { describe, expect, it } from "vitest";
import { applyStreamQuirks } from "../../open-sse/utils/streamQuirks.js";

const context = { provider: "unknown", omitBuyerCost: () => false };
describe("passthrough chunk quirks", () => {
  it("preserves Azure cleanup and empty tool-call cleanup", () => {
    const chunk = { object: "chat.completion.chunk", created: 1, prompt_filter_results: [], choices: [{ content_filter_results: {}, delta: { content: "hello", tool_calls: [] } }] };
    expect(applyStreamQuirks(chunk, context)).toBe(true);
    expect(chunk).toEqual({ object: "chat.completion.chunk", created: 1, choices: [{ delta: { content: "hello" } }] });
  });
  it("leaves ordinary provider chunks untouched", () => {
    const chunk = { type: "ping" };
    expect(applyStreamQuirks(chunk, context)).toBe(false);
    expect(JSON.stringify(chunk)).toBe('{"type":"ping"}');
  });
});
